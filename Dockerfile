FROM node:alpine

RUN apk --no-cache add wget
RUN mkdir /app
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm i
RUN chown -R node ./node_modules/sonos-http-api
RUN npm audit fix
COPY index.js ./

CMD npm start
USER node

HEALTHCHECK CMD wget -q localhost:5005 -O /dev/null || exit 1
