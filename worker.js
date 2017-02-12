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

  worker.on( "message", function( msg, next, id ){
    log.debug(`Got message, queue: ${qname} message id is ${id}`);

    worker.info( function (err, workerInfo){
      if (err) return callback(err);
      log.debug('Worker info', workerInfo);
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
        if (err && (removeOnError !== true)) return log.error(`not removing ${object.msg.fileID} from queue`);

        // Delete the fileID from the redis so it can be added laiter
        var indexResponse = res;
        redisClient.del(object.msg.fileID, function (err, res){
          if (err) log.error('Error deleting:' + object.msg.fileID, err);
          var message = `Proceesed message id: ${id} and fileID: ${object.msg.fileID} filename: ${indexResponse.fileName}`;
          log.info(message);
          next();
        });
      });
    });
  });

  worker.start();
}


function sanityCheck(object, callback){
  var checks = {
    elasticsearch : function (obj, cb){
      elasticsearchClient.ping(function (err, res){
        if (err) return cb('Elasticsearch error: '+ err);

        cb(null, obj);
      })
    },
    exists : function (obj, cb){
      fs.stat(obj.msg.path, function (err, res){
        if (err) return cb(`"${filePath}" not found`, true);

        cb(null, obj);
      });
    },
    filename : function (obj, cb){

      var fileName = path.parse(obj.msg.path).name;
      var filePath = obj.msg.path;

      if (fileName.charAt(0) === '.'){
        return cb(`"${fileName}" is not a valid file for indexing`, true);
      }
      cb(null, obj);
    },
    extensions : function (obj, cb){
      var supportedExtensions = ['.tiff','.tif', '.jpg', '.jpeg', '.png'];

      var ext = path.parse(obj.msg.path).ext;


      if (supportedExtensions.indexOf(ext) > -1){
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
    if (err) return callback(err, object);

    log.debug(`Finished creating source image for ${fileName} size: ${res.length}`);

    object.msg._source_image_buffer = res;

    callback(null, object);
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
    if (err) return callback(err, object);

    log.debug(`Finished creating thumbnails for ${fileName}`);

    callback(err, object);
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
    if (err) return callback(err, basicInfo);

    log.debug(`Finished indexing ${fileName}`, basicInfo);


    object = null;
    callback(err, basicInfo);

  });

}
