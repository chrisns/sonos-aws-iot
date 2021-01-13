const SonosSystem = require('sonos-discovery')
const SonosHttpAPI = require('sonos-http-api/lib/sonos-http-api.js')
const settings = require('sonos-http-api/settings')
const nodeStatic = require('node-static')
const http = require('http')
const requireDir = require('sonos-http-api/lib/helpers/require-dir')
const path = require('path')
const awsIot = require('aws-iot-device-sdk')
const fileServer = new nodeStatic.Server(settings.webroot);

const MQTT_PREFIX = process.env.MQTT_PREFIX

const device = awsIot.device({
  accessKeyId: process.env.AWS_ACCESS_KEY,
  secretKey: process.env.AWS_SECRET_ACCESS_KEY,
  host: process.env.AWS_IOT_ENDPOINT_HOST,
  protocol: "wss",
})

device.on('connect', () => console.log("aws - connected"))
device.on('connect', () => device.subscribe(`${MQTT_PREFIX}#`, console.log))

device.on('error', (error) => console.error('aws - error', error))

device.on('close', (err) => console.error("aws - connection close", err))

device.on('offline', () => console.log("aws - offline"))

const discovery = new SonosSystem(settings)

function SonosMQTTAPI(discovery, settings) {

  const port = settings.port
  const webroot = settings.webroot
  const actions = {}

  this.getWebRoot = () => webroot

  this.getPort = () => port

  this.discovery = discovery



  // this handles registering of all actions
  this.registerAction = (action, handler) => {
    console.log(action)
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
    if (topic === `${MQTT_PREFIX}out`) // loopback
      return

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
        if ((!response || response.constructor.name === 'IncomingMessage') || (Array.isArray(response) && response.length > 0 && response[0].constructor.name === 'IncomingMessage')) {
          response = { status: 'success' }
        }
        sendResponse(response)
      })
      .catch(error =>
        sendResponse({ status: 'error', error: error.message, stack: error.stack })
      )

  }

  function handleAction(options) {
    let player = options.player

    if (!actions[options.action]) {
      return Promise.reject({ error: 'action \'' + options.action + '\' not found' })
    }

    return actions[options.action](player, options.values)

  }

}

const sendResponse = body => {
  device.publish(`${MQTT_PREFIX}out`, JSON.stringify(body))
  console.log(body)
}

const api = new SonosMQTTAPI(discovery, settings)
const httpapi = new SonosHttpAPI(discovery, settings);

device.on('message', api.requestHandler)

module.exports = api

const httprequestHandler = (req, res) =>
  req.addListener('end', () =>
    fileServer.serve(req, res, err => {

      if (!err) {
        return;
      }

      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (req.headers['access-control-request-headers']) {
        res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers']);
      }

      if (req.method === 'GET') {
        httpapi.requestHandler(req, res);
      }
    })
  ).resume()

const server = http.createServer(httprequestHandler);
server.listen(settings.port, settings.ip, function () {
  console.log('http server listening on', settings.ip, 'port', settings.port);
});