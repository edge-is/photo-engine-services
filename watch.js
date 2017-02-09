


var _utils = require('./lib/utils.js');

var config = _utils.readConfig(__dirname + '/config.yml');

var Compare = _utils.compare;


var RedisSMQ = require("rsmq");
var rsmq = _utils.rsmq(config);

var path = require('path');
var redis = require("redis");
var redisClient = redis.createClient({
  host : config.redis.server,
  port : config.redis.port
});
var argv = require('yargs').argv;
var logger = require('./lib/logger.js');
var log = logger(config, 'watch', argv.v);

redisClient.on("error", function (err) {
    log.error("Error " + err);
});


redisClient.on("connect", function (info) {
    log.info('Connected', config.redis.server);
});

redisClient.on("ready", function (info) {
    log.info('ready', config.redis.server);
});


// Create logger

_utils.createQueue(rsmq, config.queue , function (err, qname) {
  if (err) return log.error(err);
  log.info('Starting comparing images');
  startComparing(qname, config.interval);
});

function startComparing(qname, time){
  _utils.service(config.interval, function (){

    log.info('Comparing:', config.compare.source, config.compare.destination);
    var compare = new Compare(config.compare.source, config.compare.destination, {
      extension : config.compare.extension
    }).start();

    compare.on('file', function (file){
      var name = path.parse(file.path).name;
      file.fileID = _utils.md5(file.path);
      var json = _utils.JSON.stringify(file);
      // Create id for filename, make sure it does not exist before adding to queue
      redisClient.get(file.fileID, function(err, reply) {
          // reply is null when the key is missing
          //
          if (reply) return log.info(`${name} with ID:${file.fileID} already exists, skipping`);

          if (err) return log.error('REDIS ERROR', err);

          rsmq.sendMessage({ qname : qname, message : json }, function (err, res){
            log.info(`Added: ${name} with ID:${file.fileID} to queue`);
            redisClient.set(file.fileID, new Date().getTime());
          });
      });
    });
  });
}
