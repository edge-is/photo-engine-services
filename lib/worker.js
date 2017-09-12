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
    self.log.info({ jobID: job.id },`active`);
  })

  self.queue.on('stalled', function(job){
    self.log.info({ jobID: job.id },`stalled`);
    // A job has been marked as stalled. This is useful for debugging job
    // workers that crash or pause the event loop.
  })

  self.queue.on('progress', function(job, progress){
    self.log.info({ jobID: job.id },`progress`);
    // A job's progress was updated!
  })

  self.queue.on('completed', function(job, result){
    self.log.info({ jobID: job.id },`completed`);
    // A job successfully completed with a `result`.
  })

  self.queue.on('failed', function(job, err){
    self.log.info({ jobID: job.id },`failed`);
    // A job failed with reason `err`!
  })

  self.queue.on('paused', function(job){
    self.log.info({ jobID: job.id },`paused`);
    // The queue has been paused.
  })

  self.queue.on('resumed', function(job){
    self.log.info({ jobID: job.id },`resumed`);
    // The queue has been resumed.
  })

  self.queue.on('cleaned', function(jobs, type) {
    self.log.info({ jobID: job.id },`cleaned`);
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

    self.log.info({ namespace : namespace}, `Creating pipeline with name: ${namespace}`);
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
  self.log.info({ jobID : job.id, file : job.data.path, namespace : namespace } , `Message from queue`);
  var pipeline = self.pipelines[namespace];
  // Run waterfall on commands..
  async.waterfall([
    async.apply(pipeline.fetchFile, job),
    pipeline.createSource,
    pipeline.createWatermark,
    pipeline.readExif,
    pipeline.checkThumbnailsExists,
    pipeline.createThumbnails,
    pipeline.storeThumbnails,
    pipeline.indexExif,
    pipeline.storeSource

  ],
  function (err, res){

    pipeline = null;
    if (err){
      self.log.error({ jobID : job.id, file : job.data.path, namespace : namespace } , `Failed to process image` , err);
      // Get next but do not delete it from the queue
      return self.status.failed(job.data.fileID, function (err, res){
        if (err) self.log.error({ jobID : job.id, file : job.data.path, namespace : namespace } , 'Error updating', err);
        return next('Could not process image', err);
      });
    }
    self.log.info({ jobID : job.id, file : job.data.path, namespace : namespace } , `Done processing`);

    var now = new Date().getTime();

    var filename = path.parse(job.data.file.path).name;

    var diff = (now - start);

    // Delete the fileID from the redis so it can be added laiter

    self.status.done(job.data.fileID, function (err, res){
      if (err) self.log.error({ jobID : job.id, file : job.data.path, namespace : namespace } , 'Error updating', err);

      job.progress(100);

      self.log.info({ jobID : job.id, file : job.data.path, namespace : namespace } , `Job done successfully`);
      job = null;
      return next();
    });

  });

}

module.exports = Worker;
