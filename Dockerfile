FROM node:alpine as builder
RUN apk add --no-cache git
WORKDIR /app
COPY package.json .
COPY package-lock.json .
RUN npm i
RUN npm audit fix

FROM node:alpine
RUN apk add --no-cache wget
COPY --from=builder /app /app
WORKDIR /app 
COPY index.js .
RUN chown -R node ./node_modules/sonos-http-api
USER node
CMD npm start

HEALTHCHECK CMD wget -q localhost:5005 -O /dev/null || exit 1
