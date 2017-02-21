/**
  1. Scale image
  2. thumbnail image
  3. index image
  if fail any then log and continue
**/



var async = require('async');
var u = require('./lib/utils.js');
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

var Pipeline = require('./lib/pipeline.js')
var configLoader = require('./lib/config-loader.js');

var loader = configLoader('./config.yml');


if (!argv.v){
  console.log('Starting.. logging to file, -v for verbose');
  process.env.VIPS_WARNING=0;
}


var service = false;
loader.on('ready', function (conf){
  // Load all config stuff
  var log = logger(conf, 'worker', argv.v);
  //var pipeline = require('./lib/pipeline.js')(config,log);

  var redisClient = redis.createClient({
    host : conf.redis.server,
    port : conf.redis.port
  });
  var elasticsearchClient = new elasticsearch.Client({
    hosts : conf.index.elasticsearch,
    log : function (){
      return log;
    }
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


  function start(conf){
    log.info(`Starting in queue: ${conf.queue}`);
    u.createQueue(rsmq, conf.queue, function (err, res){
      var pipelines = createPipelines(conf, log, elasticsearchClient);

      startWorking(rsmq, conf, log, status, pipelines);
    });
  }

});

loader.on('error', function (error){
  console.log(error);
});

function createPipelines(config, log, elasticsearchClient){
  var pipelines = {};

  config.servers.forEach(function (server){
    var namespace = Object.keys(server).pop();
    if (server[namespace].disabled) log.warning(`${namespace} is disabled`);
    var pipeline = Pipeline(config, namespace, log, elasticsearchClient);

    pipelines[namespace] = pipeline;
  });

  return pipelines;
}

function isDisabled(config, namespace){
  var server= config.servers.filter(function (item){
    var name = Object.keys(item).pop();
    return ( namespace === name);
  }).pop();

  return server[namespace].disabled;
}

function startWorking(rsmq, config, log, status, pipelines){

  var qname = config.queue;
  var worker = new RSMQWorker(config.queue, { rsmq : rsmq, timeout : config.worker.timeout || 20000 } );

  log.debug('Starting worker queue nane is:', qname);
  log.debug('Waiting for message on queue:', qname);

  worker.info( function (err, workerInfo){
    log.debug('Worker info', qname, workerInfo);
  })

  worker.on( "message", function( msg, next, id ){
    log.debug(`Got message, queue: ${qname} message id is ${id}`);

    worker.info( function (err, workerInfo){
      if (err) return callback(err);

      var start = new Date().getTime();
      log.info(`Worker info, Messages: ${workerInfo.msgs}, Total sent: ${workerInfo.totalsent}, Total recived ${workerInfo.totalrecv}`);


      var message = u.JSON.parse(msg);
      var namespace = message.namespace;

      message.message_id = id;
      message._info = workerInfo;
      log.info(`New message from queue:${id}, namespace: ${namespace}`);

      if (isDisabled(config, namespace)){

        log.info(`${namespace} is disabled ...`);
        return next(false);
      }

      // SElect the right pipeline for the job
      var pipeline = pipelines[namespace];

      // Run waterfall on commands..
      async.waterfall([

        async.apply(pipeline.fetchFile, message),
        pipeline.createSource,
        pipeline.createWatermark,
        pipeline.readExif,
        pipeline.createThumbnails,
        pipeline.storeThumbnails,
        pipeline.indexExif,
        pipeline.storeSource

      ],
      function (err, res){

        pipeline = null;
        if (err){
          log.error(err);
          var errorMessage = err;

          if (err instanceof Error){
            errorMessage = err.toString();
          }
          if (typeof err === 'object'){
            errorMessage = u.JSON.stringify(err);
          }
          // Get next but do not delete it from the queue
          return status.update(message.fileID, { status: "error", time : now, error:errorMessage }, function (err, res){
            if (err) log.error('Error updating:' + message.fileID, err);


            return next(false);
          });
        }

        var now = new Date().getTime();

        var filename = path.parse(message.file.path).name;

        var diff = (now - start);

        // Delete the fileID from the redis so it can be added laiter

        status.update(message.fileID, { status: "finished", time : now }, function (err, res){
          if (err) log.error('Error updating:' + message.fileID, err);

          log.info(`Proceesed message id: ${id} and fileID: ${message.fileID} filename: ${filename}`);
          object = null;
          message = null;
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
