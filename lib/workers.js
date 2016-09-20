
var RSMQWorker = require( "rsmq-worker" );

var _utils = require('./utils.js');

var async = require('async');

var argv = require('yargs').argv;

const EventEmitter = require('events');
const emitter = new EventEmitter();

var Workers = function (config){

  var self = this;
  self.config = config;
  self.rsmq = _utils.rsmq(config);
  return self;
}
Workers.prototype.init = function (){
  var self = this;
  var config = self.config;
  self.workers = {};
  self.queues = {};
  async.eachOfLimit(config.queue, 1, function (qName, key, next){
    self.workers[key] = new RSMQWorker(qName, { rsmq : self.rsmq, timeout : 20000 } );
    _utils.createQueue(self.rsmq, qName, function (err, name){
      if (argv.verbose) console.log('CREATING', qName, name);
      self.queues[key] = name;

      next();
    });

  }, function (){
    emitter.emit('ready');
  });
  return emitter;
}

Workers.prototype.__createWorker = function(name, callback){
  var self = this;
  var _worker = self.workers[name];
  var rsmq = self.rsmq;
  var queues = self.queues;

  var config = self.config;

  _worker.on( "message", function( msg, next, id ){
    _worker.info( function (err, workerInfo){
      if (err) return callback(err);
      var object = {};
      object.msg= _utils.JSON.parse(msg);
      object.id = id;
      object.info = workerInfo;

      if (name === 'index') return callback(null, object, next);

      var nextQ = (name === 'sync') ? 'thumbnail' : 'index';

      callback(null, object, function (){
        if (argv.verbose) console.log('ADDING TO NEXT Q', nextQ,  queues);
        // Send to next queue -> nextQ;
        rsmq.sendMessage({ qname : queues[nextQ], message : msg }, function (err, res){
          return next();
        });
      });
    });
  });

  return _worker;
}

Workers.prototype.getWorker = function (name){
  var self = this;
  var availableWorkers = {
    thumbnail: function (callback){
      return self.__createWorker('thumbnail', callback).start();

    },
    index : function (callback){
      return self.__createWorker('index', callback).start();

    },
    sync : function (callback){
      return self.__createWorker('sync', callback).start();
    }
  };

  return availableWorkers[name];
}



module.exports = Workers;
