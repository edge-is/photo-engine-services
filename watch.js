


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

if (!argv.v){
  console.log('Starting.. logging to file, -v for verbose');
}


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
      supportedFile(file, function (err, supported){

        if (err) return log.info(err);
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
    compare.on('end', function (stats){
      log.info(`Scan ended`);
    });
  });
}



function supportedFile(file, cb){
  var supportedExtensions = ['.tiff','.tif', '.jpg', '.jpeg', '.png'];
  var ext = path.parse(file.path).ext;

  var name = path.parse(file.path).name;

  if (name.charAt(0) === '.'){
    return cb(`'${file.path}' is hidden and not a valid file for indexing`);
  }

  if (supportedExtensions.indexOf(ext) === -1){
    return cb(`'${file.path}' is not an image and not supported`);
  }

  // check the size of the file


  cb(null, true);


}
