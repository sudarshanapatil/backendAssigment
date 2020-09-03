const express = require('express');
const bodyParser = require('body-parser');
const unirest = require('unirest');
const redis = require('redis');
const bluebird = require("bluebird");

const API_SERVER_PORT = 5000;
const Rapid_API_Host = "apidojo-yahoo-finance-v1.p.rapidapi.com";
const Rapid_API_Key = '6684a50ca9msh9fdcfe07b379e10p17649bjsn007fdbc1b93f';
const baseUrl = 'https://apidojo-yahoo-finance-v1.p.rapidapi.com/stock';
const headers = {
  "x-rapidapi-host": Rapid_API_Host,
  "x-rapidapi-key": Rapid_API_Key,
  "useQueryString": true
}

const app = express();
bluebird.promisifyAll(redis.RedisClient.prototype);
bluebird.promisifyAll(redis.Multi.prototype);

const client = redis.createClient({
  port:'16592',
  host:'redis-16592.c16.us-east-1-3.ec2.cloud.redislabs.com',
  password:'X4pXMIQtg81AxG1z3Pv1XfncEpepwj5N',
});

client.on('connect', () => {
  console.log('Connected to Redis');
  app.listen(API_SERVER_PORT, () => {
    console.log('Server started on port', API_SERVER_PORT);
  });
});

app.use(bodyParser.urlencoded({
  extended: true
}));
app.use(bodyParser.json());

app.get('/get-analysis', (request, response) => {
  let { symbol } = request.query;
  let key = `stock::news::${symbol}`;

  client.getAsync(key)
    .then((data) => {
      if (data === null) {           //data is not cached in redis
        const req = unirest("GET", `${baseUrl}/v2/get-analysis`);
        req.query({
          "symbol": request.query.symbol
        });
        req.headers(headers);
        req.end((res) => {
          if (res.error) {
            response.send({ code: 500, err: res.error });
          } else {
            client.setAsync(key, JSON.stringify(res), 'EX', 60 * 60 * 24)
              .then(() => {
                response.send(res);
              })
              .catch((err) => {
                console.log(err);
              })
          }
        });
      }
      else {
        response.send(JSON.parse(data));
      }
    })
});

app.get('/get-news', (request, response) => {
  let { region, category } = request.query;
  let key = `stock::news::${region}::${category}`;
  let key1 = `${key}::1`;
  let key2 = `${key}::2`;

  client.mgetAsync([key1, key2])
    .then((data) => {
      if (data[0] === null || data[1] === null) {  //data is not cached in redis
        const req = unirest("GET", `${baseUrl}/get-news`);
        req.query({
          "region": region,
          "category": category
        });
        req.headers(headers);
        req.end((res) => {
          if (res.error) {
            response.send({ code: 500, err: res.error });
          } else {
            let totalData = res.body.items.result.length;
            let data1 = res.body.items.result.slice(0, Math.round(totalData / 2));
            let data2 = res.body.items.result.slice(Math.round(totalData / 2), totalData);
            client.setAsync(key1, JSON.stringify(data1), 'EX', 60 * 60 * 24)
              .catch((error) => {
              })
            client.setAsync(key2, JSON.stringify({
              statusCode: res.statusCode,
              headers: res.headers,
              request: res.request,
              data: data2
            }), 'EX', 60 * 60 * 24)
              .catch((error) => {
              })
            response.send(res);
          }
        });
      } else {
        let allData = JSON.parse(data[1]);
        let itemArr = [...JSON.parse(data[0]), ...allData.data];
        delete allData.data;
        allData.body = { items: {} };
        allData.body.items.result = itemArr;
        response.send(allData);
      }
    })
});
