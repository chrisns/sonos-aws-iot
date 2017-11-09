const SonosSystem = require('sonos-discovery')
const SonosHttpAPI = require('sonos-http-api/lib/sonos-http-api.js')
const settings = require('sonos-http-api/settings')
const nodeStatic = require('node-static')
const http = require('http')
const requireDir = require('sonos-http-api/lib/helpers/require-dir')
const path = require('path')

var awsIot = require('aws-iot-device-sdk');

var device = awsIot.device({
// keyPath: <YourPrivateKeyPath>,
//   certPath: <YourCertificatePath>,
//     caPath: <YourRootCACertificatePath>,
//       clientId: <YourUniqueClientIdentifier>,
//         host: <YourCustomEndpoint>
});

/*thing shadow stuff
var thingShadows = awsIot.thingShadow({
  // keyPath: <YourPrivateKeyPath>,
  //   certPath: <YourCertificatePath>,
  //     caPath: <YourRootCACertificatePath>,
  //       clientId: <YourUniqueClientIdentifier>,
  //         host: <YourCustomEndpoint>
});

thingShadows.on('connect', () =>
  thingShadows.register('sonos', {}, () => {
    if (thingShadows.update('RGBLedLamp', {"state": {"desired": {"red": 123}}}) === null) {
      console.log('update shadow failed, operation still in progress');
    }
  })
);

thingShadows.on('status', (thingName, stat, clientToken, stateObject) =>
  console.log('received ' + stat + ' on ' + thingName + ': ' + JSON.stringify(stateObject)))

thingShadows.on('delta', (thingName, stateObject) =>
  console.log('received delta on ' + thingName + ': ' + JSON.stringify(stateObject)))

thingShadows.on('timeout', (thingName, clientToken) =>
  console.log('received timeout on ' + thingName + ' with token: ' + clientToken));
*/

device.on('connect', () => console.log("aws - connected"))

device.on('error', (error) => console.error('aws - error', error))

device.on('close', () => console.error("aws - connection close"))

device.on('offline', () => console.log("aws - offline"))

const discovery = new SonosSystem(settings)

function SonosMQTTAPI(discovery, settings) {

  const port = settings.port
  const webroot = settings.webroot
  const actions = {}

  this.getWebRoot = () => webroot

  this.getPort = () => port

  this.discovery = discovery

  /* TODO: migrate to thing shadows
  const player_related_events = [
    'group-mute',
    'transport-state',
    'group-volume',
    'volume-change',
    'mute-change',
  ]

  const system_related_events = [
    'list-change',
    'initialized',
    'topology-change',
  ]

  player_related_events.forEach(action =>
    discovery.on(action, player => {
      let topic = `${MQTT_PREFIX}${player.roomName.toLowerCase().replace(" ", "-")}/${action}`
      client.publish(topic.toLowerCase(), JSON.stringify(player))
    })
  )
  system_related_events.forEach(action =>
    discovery.on(action, system => {
      let topic = `${MQTT_PREFIX}system/${action}`
      client.publish(topic.toLowerCase(), JSON.stringify(system))
    })
  )
  */

  // this handles registering of all actions
  this.registerAction = (action, handler) => {
    device.subscribe(`${MQTT_PREFIX}${action}`, {qos: 1})
    device.subscribe(`${MQTT_PREFIX}${action}/#`, {qos: 1})
    actions[action] = handler
  }

  //load modularized actions
  requireDir(path.join(__dirname, './node_modules/sonos-http-api/lib/actions'), (registerAction) => {
    registerAction(this)
  })

  this.requestHandler = (topic, message) => {
    if (discovery.zones.length === 0) {
      console.error('System has yet to be discovered')
      return
    }

    const params = topic.replace(MQTT_PREFIX, "").split('/')
    const opt = {}

    opt.player = discovery.getPlayer(params.pop())

    try {
      opt.values = JSON.parse(message.toString())

    }
    catch (e) {
      opt.values = [message.toString()]
    }

    opt.action = params[0]

    if (!opt.player) {
      opt.player = discovery.getAnyPlayer()
    }

    handleAction(opt)
      .then((response) => {
        if (!response || response.constructor.name === 'IncomingMessage') {
          response = {status: 'success'}
        } else if (Array.isArray(response) && response.length > 0 && response[0].constructor.name === 'IncomingMessage') {
          response = {status: 'success'}
        }
        // sendResponse(response)
      }).catch((error) => {
      console.error(error)
      // sendResponse({status: 'error', error: error.message, stack: error.stack})
    })

  }

  function handleAction(options) {
    let player = options.player

    if (!actions[options.action]) {
      return Promise.reject({error: 'action \'' + options.action + '\' not found'})
    }

    return actions[options.action](player, options.values)

  }

}

// const sendResponse = body => {
//   client.publish(`${MQTT_PREFIX}out`, JSON.stringify(body), {qos: 1})
//   console.log(body)
// }

const api = new SonosMQTTAPI(discovery, settings)

const file = new nodeStatic.Server(settings.webroot)

http.createServer((request, response) =>
  request.addListener('end', () => file.serve(request, response)
  ).resume()
).listen(settings.port)

device.on('message', api.requestHandler)

module.exports = api