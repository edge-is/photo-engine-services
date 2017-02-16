


var _utils = require('./lib/utils.js');

var config = _utils.readConfig(__dirname + '/config.yml');

var Compare = _utils.compare;
var Status = require('./lib/status.js');


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


if (argv.h){
  return console.log(`
    -v  verbose
    -n  dry run
    -h  help message
    -c  <yaml file>
    `)
}


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



var status = new Status(config.status, redisClient);


// Create logger

if (argv.n){
  return startComparing(config.queue , '300h');
}

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

    var fn = onFile;

    if (argv.n){
      fn = dryFile
    }

    compare.on('file', fn);
    compare.on('end', function (stats){
      log.info(`Scan ended`);
      setTimeout(function (){

        // Delete compare aftier 1sek
        compare = null;
      }, 1000)
    });
  });
}


function dryFile(file){
  var name = path.parse(file.path).name;
  file.fileID = _utils.md5(file.path);
  var json = _utils.JSON.stringify(file);
  supportedFile(file, function (err, supported){
    if (err) return log.error(err);
    log.info({
      file : file.path,
      fileID : file.fileID
    });

  });
}

function onFile(file){
  var name = path.parse(file.path).name;
  file.fileID = _utils.md5(file.path);

  file._scanAt = new Date().getTime();


  var json = _utils.JSON.stringify(file);
  supportedFile(file, function (err, supported){

    if (err) return log.info(err);
    // Create id for filename, make sure it does not exist before adding to queue
    status.get(file.fileID, function(err, reply) {
      if (err) return log.error('REDIS ERROR', err);

      if (reply)  {
        if (reply.status !== 'finished'){
          // if not finished then skip it
          return log.info(`${name} with ID:${file.fileID} already exists, skipping, current status is '${reply.status}'`);
        }
      }

      rsmq.sendMessage({ qname : config.queue, message : json }, function (err, res){
        if (err) return log.error(`Error adding to queue '${config.queue}'`);

        log.info(`Added: ${name} with ID:${file.fileID} to queue`);

        status.set(file.fileID, { scannedOn: process.env.HOSTNAME, queueID: res, status: "scanned", created : new Date().getTime()});
      });
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

  //
  // Delete variable for gc
  file = null;

  cb(null, true);


}
