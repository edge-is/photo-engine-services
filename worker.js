/**
  1. Scale image
  2. thumbnail image
  3. index image
  if fail any then log and continue
**/



var async = require('async');
var _utils = require('./lib/utils.js');
var RSMQWorker = require( "rsmq-worker" );
var RedisSMQ = require("rsmq");
var redis = require("redis");

var Status = require('./lib/status.js');

var elasticsearch = require('elasticsearch');

var path = require('path');
var fs = require('fs');

var Converter = require('./lib/converter.js');

var Thumbnails = require('./lib/thumbnails.js');
var logger = require('./lib/logger.js');

var argv = require('yargs').argv;

var Indexer = require('./lib/index.js');

var configLocation = __dirname + '/config.yml';

if (typeof argv.c  ===  'string'){
  configLocation = argv.c;
}

var config = _utils.readConfig(configLocation);

var rsmq = _utils.rsmq(config);
var redisClient = redis.createClient({
  host : config.redis.server,
  port : config.redis.port
});


if (!argv.v){
  console.log('Starting.. logging to file, -v for verbose');
  process.env.VIPS_WARNING=0;
}

var log = logger(config, 'worker', argv.v);


log.warning = log.warn;
var elasticsearchClient = new elasticsearch.Client({
  hosts : config.index.elasticsearch,
  log : function (){
    return log;
  }
});

var status = new Status(config.status, redisClient);

var indexer = new Indexer(config.index, log);
var thumbnails = new Thumbnails(config.thumbnails, log);
var converter = new Converter(config.source, log);

redisClient.on("error", function (err) {
    log.error("Error " + err);
});

redisClient.on("connect", function (info) {
    log.info('Connected', config.redis.server);
});

redisClient.on("ready", function (info) {
    log.info('ready', config.redis.server);
});


log.debug('Connecting to REDIS ', config.redis);
_utils.createQueue(rsmq, config.queue , function (err, qname) {
  if (err) return log.error(err);
  log.debug('Starting worker');
  startWorking(rsmq, qname);
});




function startWorking(rsmq, qname){
  var worker = new RSMQWorker(qname, { rsmq : rsmq, timeout : config.worker.timeout || 20000 } );

  log.debug('Starting worker queue nane is:', qname);
  log.debug('Waiting for message on queue:', qname);

  worker.info( function (err, workerInfo){
    log.debug('Worker info', qname, workerInfo);
  })

  worker.on( "message", function( msg, next, id ){
    log.debug(`Got message, queue: ${qname} message id is ${id}`);

    worker.info( function (err, workerInfo){
      if (err) return callback(err);
      log.info(`Worker info, Messages: ${workerInfo.msgs}, Total sent: ${workerInfo.totalsent}, Total recived ${workerInfo.totalrecv}`);
      var object = {};
      object.msg= _utils.JSON.parse(msg);
      object.message_id = id;
      object._info = workerInfo;
      log.info('New message from queue:', id)
      // Run waterfall on commands..
      async.waterfall([

        async.apply(sanityCheck, object),
        createSourceImage,
        createThumbnail,
        indexImage
      ],
      function (err, res){

        var removeOnError = res;

        if (err) log.error(err);
        if (err && (removeOnError !== true))  {
          log.error(`not removing ${object.msg.fileID} from queue, message id: ${id} file: ${object.msg.path}`);

          var errMSG = _utils.JSON.stringify(err);

          if (err instanceof Error){
            errMSG = err.toString();
          }

          return status.update(object.msg.fileID, { status: "error", time : new Date().getTime(), error: errMSG }, function (err, res){
            if (err) log.error('Error updating:' + object.msg.fileID, err);

            setOldTimestamp(object.msg.dst, function (err){
              object = null;
              return next();
            });
          });

        }

        // Delete the fileID from the redis so it can be added laiter
        var indexResponse = res;

        status.update(object.msg.fileID, { status: "finished", time : new Date().getTime() }, function (err, res){
          if (err) log.error('Error updating:' + object.msg.fileID, err);
          log.info(`Proceesed message id: ${id} and fileID: ${object.msg.fileID} filename: ${indexResponse.fileName}`);
          object = null;
          return next();
        });


      });
    });
  });

  worker.on('exceeded', function( msg ){
      log.error('exceeded: ', msg);
  });

  worker.on('timeout', function( msg ){
      log.error('timeout: ', msg);
  });


  worker.start();
}


function sanityCheck(object, callback){
  var checks = {
    elasticsearch : function (obj, cb){
      log.debug('Checking Elasticsearch', config.index.elasticsearch);
      elasticsearchClient.ping({
        requestTimeout: 10000
      },function (err, res){
        if (err) return cb('Elasticsearch error: '+ err);

        log.debug('Elasticsearch OK', config.index.elasticsearch);

        cb(null, obj);
      })
    },
    exists : function (obj, cb){

      log.debug('Check if file exists', obj.msg.path);

      fs.stat(obj.msg.path, function (err, res){
        if (err) return cb(`"${filePath}" not found`, true);
        log.debug('File exists', obj.msg.path);

        cb(null, obj);
      });
    },
    filename : function (obj, cb){


      var fileName = path.parse(obj.msg.path).name;
      var filePath = obj.msg.path;
      log.debug('Checking if file is valid', fileName);

      if (fileName.charAt(0) === '.'){
        return cb(`"${fileName}" is not a valid file for indexing`, true);
      }

      log.debug('File is valid', fileName);

      cb(null, obj);
    },
    extensions : function (obj, cb){
      var fileName = path.parse(obj.msg.path).name;

      log.debug('Checking if file has valid extension', fileName);

      var supportedExtensions = ['.tiff','.tif', '.jpg', '.jpeg', '.png'];

      var ext = path.parse(obj.msg.path).ext;


      if (supportedExtensions.indexOf(ext) > -1){
        log.debug('File has valid extension', fileName);

        return cb(null, obj);
      }
      cb(`${ext} is not supported extension`, true);

    }
  };

  async.waterfall([
    async.apply(checks.filename, object),
    checks.exists,
    checks.elasticsearch,
    checks.extensions
  ],function (err, res){
    if (err) return callback(err, res);

    var fileName = path.parse(object.msg.path).name;
    log.debug(`File ${fileName} is OK for processing`);
    callback(null, object);
  });



}


function createSourceImage(object, callback){
  var fileName = path.parse(object.msg.path).name;
  log.debug(`Starting to create source image for ${fileName}`);
  converter.convert(object.msg, function (err, res){
    if (err){
      object = null;
      return callback(err, false);
    }

    log.debug(`Finished creating source image for ${fileName} size: ${res.length}`);

    object.msg._source_image_buffer = res;

    object._dst = object.dst;

    status.update(object.msg.fileID, { status: "sourceimage", time_source : new Date().getTime() }, function (err, res){
      if (err) return callback(err);
      callback(null, object);
    });


  });
}
function createThumbnail(object, callback){
  var fileName = path.parse(object.msg.path).name;


  object.path = object.dst;
  delete object.dst;

  log.debug(`Starting creating thumbnails for ${fileName} size: ${object.msg._source_image_buffer.length}`);
  log.debug(`Total number of thumbnails for ${fileName} are: ${config.thumbnails.profile.length}`);


  // now change path value to dst value so we use the new sourceImage

  thumbnails.create(object.msg, function (err, res){
    if (err){
      object = null;
      return callback(err, false);
    }

    log.debug(`Finished creating thumbnails for ${fileName}`);

    status.update(object.msg.fileID, { status: "thumbnails",  time_thumbnail : new Date().getTime() }, function (err, res){
      if (err) return callback(err);
      callback(null, object);
    });
  });
}

function indexImage(object, callback){
  var fileName = path.parse(object.msg.path).name;
  log.debug(`Starting indexing ${fileName}`);

  indexer.index(object.msg, function (err, res){

    var basicInfo = {
      path : object.msg.path,
      fileName : path.parse(object.msg.path).name,
      elasticsearch : res
    };
    if (err)  {
      object = null;
      return callback(err, basicInfo);
    }

    log.debug(`Finished indexing ${fileName}`, basicInfo);

    status.update(object.msg.fileID, { status: "indexed", time_index : new Date().getTime() }, function (err, res){
      if (err) return callback(err);
      object = null;
      callback(null, basicInfo);
    });

  });

}


function setOldTimestamp(image, callback ){
  fs.stat(image, function (err, stat){
    if (err) return callback(err);
    // set 1.jan 2000
    fs.utimes(image, 946684800, 946684800, callback);
  })
}
