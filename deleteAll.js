

var async = require('async');
var _utils = require('./lib/utils.js');

var config = _utils.readConfig(__dirname + '/config.yml');


var argv = require('yargs').argv;


var redis = require("redis");

if (!argv['yes-delete-all']){
  return console.log(`
    Please use --yes-delete-all
    `)
}

var redisClient = redis.createClient();
redisClient.flushall(function (err, res){
  console.log('flushall',err, res, redisClient.quit());
})
