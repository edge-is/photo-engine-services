
var u = require('./lib/utils.js');

var async = require('async');
var argv = require('yargs').argv;

var logger = require('./lib/logger.js');

var path = require('path');

var configLoader = require('./lib/config-loader.js');

var loader = configLoader('./config.yml');
var RedisSMQ = require("rsmq");
var Status = require('./lib/status.js');
var redis = require('redis');


var Compare = require('./lib/compare.js')

if (!argv.v){
  console.log('Starting.. logging to file, -v for verbose');
}

if (argv.h){
  return console.log(`
    -v  verbose
    -n  dry run
    -h  help message
    -c  <yaml file>
    `)
}

var skipStatus = argv.s || false;


loader.on('ready', function (conf){
  // Load all config stuff
  var log = logger(conf, 'worker', argv.v);
  //var pipeline = require('./lib/pipeline.js')(config,log);


  var redisClient = redis.createClient({
    host : conf.redis.server,
    port : conf.redis.port
  });

  var status = new Status(conf.status, redisClient);

  var rsmq = new RedisSMQ( {host: conf.redis.server , port: conf.redis.port , ns: conf.name || 'redismq' } );
  redisClient.on("error", function (err) {
      log.error("Error " + err);
  });

  redisClient.on("connect", function (info) {
      log.info('Connected', conf.redis.server);
  });

  redisClient.on("ready", function (info) {
      log.info('ready', conf.redis.server);
      start(conf);
  });
  var service = false;

  function start(conf){
    var compare = new Compare({
      rsmq : rsmq,
      status : status,
      log : log
    });
    u.createQueue(rsmq, conf.queue, function (err, res){

      service = u.service(conf.interval, function (){
        async.forEachLimit(conf.servers, 1, function (server, next){
          var namespace = Object.keys(server).pop();
          var serverConfig = server[namespace];

          if (serverConfig.disabled) return next();

          log.info(`Starting service on interval ${conf.interval} for ${serverConfig.source.folder}`);
          compare.start(conf, namespace, next);

        });
      });
    });
  }

});

loader.on('error', function (error){
  console.log(error);
});
