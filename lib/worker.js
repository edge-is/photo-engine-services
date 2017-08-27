'use strict'
/**
  1. Scale image
  2. thumbnail image
  3. index image
  if fail any then log and continue the Queue will handle it .. i guess
**/
const fs = require('fs');
const path = require('path');
const redis = require("redis");
const async = require('async');
const argv = require('yargs').argv;
const Queue = require('bull');
const elasticsearch = require('elasticsearch');
const Status = require('./status.js');
const Converter = require('./converter.js');
const Thumbnails = require('./thumbnails.js');
const logger = require('./logger.js');
const Indexer = require('./index.js');
const u = require('./utils.js');
const createPipeline = require('./pipelines/worker.js');

var Worker = function (settings){
  var self = this;

  self.concurrency = settings.concurrency || 1;

  self.interval = settings.interval || false;

  self.config = settings.config;

  self.verbose = settings.verbose;

  if (!self.config){
    return console.log('Cannot start worker, i need config :(');
  }

  self.log = logger(self.config, 'worker', self.verbose);

  self.redisClient = settings.redisClient || redis.createClient({
     host : self.config.redis.server,
     port : self.config.redis.port
  });

  self.status = new Status(self.config.status, self.redisClient);

  self.force = settings.force || false;

  var queueRedisConfig = {
    redis: {
      port: self.config.redis.port,
      host: self.config.redis.server
    }
  };
  self.log.debug(`Creating queue ${self.config.queue}`);
  self.queue = new Queue(self.config.queue, self.queueRedisConfig);

  self.elasticsearchClient = new elasticsearch.Client({
    hosts : self.config.index.elasticsearch,
    log : function (){
      self.log.info(`Injecting log into elasticsearch client`);
      return self.log;
    }
  });

  self.status = new Status(self.config.status, self.redisClient);


    //startWorking(queue, config, log, status, pipelines);

  self.pipelines = self._createPipeline();

  return self;
};

Worker.prototype.start = function () {
  var self = this;
  self.log.info(`Starting in queue: ${self.config.queue}`);


  self.queue.count().then(function (c){
    self.log.debug(`Count is ${c}`);
  });

  queueInfo(self.queue, function (err, info){
    self.log.info(`Queue metadata: ${flatJson(info)}`);
  });

  self.queue.process(self._processJob.bind(self));


  self.queue.on('error', function(error) {
    self.log.info('error', error);
  })

  self.queue.on('active', function(job, jobPromise){
    self.log.info(`active ID: ${job.id}`);
  })

  self.queue.on('stalled', function(job){
    self.log.info(`stalled ID: ${job.id}`);
    // A job has been marked as stalled. This is useful for debugging job
    // workers that crash or pause the event loop.
  })

  self.queue.on('progress', function(job, progress){
    self.log.info(`progress ID: ${job.id}`);
    // A job's progress was updated!
  })

  self.queue.on('completed', function(job, result){
    self.log.info(`completed ID: ${job.id}`);
    // A job successfully completed with a `result`.
  })

  self.queue.on('failed', function(job, err){
    self.log.info(`failed ID: ${job.id}`);
    // A job failed with reason `err`!
  })

  self.queue.on('paused', function(){
    self.log.info(`paused ID: ${job.id}`);
    // The queue has been paused.
  })

  self.queue.on('resumed', function(job){
    self.log.info(`resumed ID: ${job.id}`);
    // The queue has been resumed.
  })

  self.queue.on('cleaned', function(jobs, type) {
    self.log.info(`cleaned ID: ${job.id}`);
    // Old jobs have been cleaned from the queue. `jobs` is an array of cleaned
    // jobs, and `type` is the type of jobs cleaned.
  });



};

Worker.prototype._createPipeline = function () {
  var self = this;
  var pipelines = {};

  self.config.servers.forEach(function (server){
    var namespace = server.name;
    if (server.disabled) self.log.warning(`${namespace} is disabled`);

    self.log.info(`Creating pipeline with name: ${namespace}`);
    var pipeline = createPipeline(self.config, namespace, self.log, self.elasticsearchClient);
    pipeline.__name = namespace;
    pipelines[namespace] = pipeline;
  });

  return pipelines;
};

function queueInfo(queue, callback){
  queue.getJobCounts().then(function (value){
    callback(null, value);
  }, callback);
}

function flatJson(object){
  var arr = [];

  for (var key in object){
    var value = object[key];
    arr.push([key, value].join(':'));
  }

  return arr.join(' | ');

}

Worker.prototype._processJob = function (job, next) {
  var self = this;
  var start = new Date().getTime();
  var message = job.data;
  var namespace = job.data._serverConfig.name;
  self.log.info(`Got message, queue: ${namespace} message id is ${job.id}`);
  var pipeline = self.pipelines[namespace];

  self.log.debug(`Starting procesing job:${job.id} in queue: ${namespace}`);
  // Run waterfall on commands..
  async.waterfall([
    async.apply(pipeline.fetchFile, job),
    pipeline.createSource,
    pipeline.createWatermark,
    pipeline.readExif,
    pipeline.createThumbnails,
    pipeline.storeThumbnails,
    pipeline.indexExif,
    pipeline.storeSource

  ],
  function (err, res){
    self.log.info(`Done processing ${job.id}`);

    pipeline = null;
    if (err){
      self.log.error(err);
      var errorMessage = err;

      if (err instanceof Error){
        errorMessage = err.toString();
      }
      if (typeof err === 'object'){
        errorMessage = u.JSON.stringify(err);
      }
      // Get next but do not delete it from the queue
      return self.status.failed(job.data.fileID, function (err, res){
        if (err) self.log.error('Error updating:' + job.data.fileID, err);
        return next(false);
      });
    }

    var now = new Date().getTime();

    var filename = path.parse(job.data.file.path).name;

    var diff = (now - start);

    // Delete the fileID from the redis so it can be added laiter

    self.status.done(job.data.fileID, function (err, res){
      if (err) self.log.error('Error updating:' + job.data.fileID, err);

      job.progress(100);

      self.log.info(`Proceesed message id: ${job.id} and fileID: ${job.data.fileID} filename: ${filename}`);
      job = null;
      return next();
    });

  });

}

module.exports = Worker;
