

var async = require('async');
var _utils = require('./lib/utils.js');

var config = _utils.readConfig(__dirname + '/config.yml');


var argv = require('yargs').argv;


var redis = require("redis");

if (!argv['yes-delete-all']){
 return console.log(`
    Please use --yes-delete-all
    -f    delete all redis data WARNING!
    `);
}

var redisClient = redis.createClient();



function flushQueue(){
  var zList = [config.name, config.queue].join('');
  redisClient.del(zList, function (err, res){

    if (err) {
      redisClient.quit();
      return console.log(err);
    }

    var zList = [config.name + config.queue, 'Q'].join(':');

    redisClient.del(zList, function (err, res){
      if (err) {
        redisClient.quit();
        return console.log(err);
      }
      console.log(`Delted message queue ${zList}`);

      redisClient.quit();
    });
  });
}

if (argv.f){
  return redisClient.flushall(function (err, res){
    console.log('flushall',err, res);
    redisClient.quit()
  });
}
flushQueue();
