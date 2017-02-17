

var _utils = require('./utils.js');

var config = _utils.readConfig(__dirname + '/../config.yml');

var Status = require('./status.js');

var path = require('path');
var redis = require("redis");

var redisClient = redis.createClient({
  host : config.redis.server,
  port : config.redis.port
});

var sub = redis.createClient({
  host : config.redis.server,
  port : config.redis.port
});
var argv = require('yargs').argv;
var logger = require('./logger.js');

var status = new Status(config.status, redisClient);
var errors = require('restify-errors');

var restify = require('restify');

var socketio = require('socket.io');

var server = restify.createServer();

var async = require('async');

var io = socketio.listen(server.server);

server.use(restify.queryParser());

server.use(restify.CORS());


redisClient.on("error", function (err) {
    console.log("Error " + err);
});


redisClient.on("connect", function (info) {
    console.log('Connected', config.redis.server);
});

redisClient.on("ready", function (info) {
  console.log('ready', config.redis.server);
  // getMessagesInQueue(config.name, config.queue, 0, 10, function (err, res){
  //   console.log(err, res);
  //
  //
  //   var msgID = res[3];
  //
  //   getMessageMetadataByID(config.name, config.queue, msgID, function (err, res){
  //     console.log(err, res);
  //   })
  // });
});


function deCodeJSON(json){
  try {
    return JSON.parse(json);
  } catch (e) {
    return json;
  }
}


function getMessagesInQueue(namespace, qname, offset, limit, callback){
  var zList = [namespace, qname].join(':');
  redisClient.ZRANGE(zList, offset, limit, callback);
}

function getMessageByID(namespace, qname, id, callback){
  var zList = [namespace, qname, 'Q'].join(':');
  redisClient.HGET(zList,id, function (err, res){
    if (err) return callback(err);

    var object =  _utils.JSON.parse(res);

    callback(null, object);
  });
}

function getMessageMetadataByID(namespace, qname, id, callback){
  getMessageByID(namespace, qname, id, function (err, res){
    if (err) return callback(err);
    getMessageMetadataByFileID(res.fileID, callback);
  })
}

function getMessageMetadataByFileID(id, callback){
  status.get(id, callback);
}

function getQueueMetadata(namespace, qname, callback){
  var zList = [namespace, qname, 'Q'].join(':');
  var mc = [["hmget", zList, "vt", "delay", "maxsize", "totalrecv", "totalsent", "created", "modified"], ["zcard", namespace +':'+ qname]];
  redisClient.multi(mc).exec(function(err, resp) {
    if (err) return callback(err);

      var data = {
        vt: parseInt(resp[0][0], 10),
        delay: parseInt(resp[0][1], 10),
        maxsize: parseInt(resp[0][2], 10),
        totalrecv: parseInt(resp[0][3], 10) || 0,
        totalsent: parseInt(resp[0][4], 10) || 0,
        created: parseInt(resp[0][5], 10),
        modified: parseInt(resp[0][6], 10),
        msgs: resp[1]
      };
      callback(null, data);
    });
}


function countMessages(namespace, qname, callback){
  var zList = [namespace, qname].join(':');

  redisClient.ZCOUNT(zList, '-inf','+inf', callback);

}

function reply(err, res, data){
 if (err) return next(new errors.InternalError(err));

 res.send({
   data : data,
   queue : config.queue
 });
 next();
}


server.get('/api/queues/items', function (req, res, next){
  var limit = req.query.limit || 10;
  var offset = req.query.offset || 0;
  getMessagesInQueue(config.name, config.queue, offset, limit, function (err, data){
    return reply(err, res, data)
  });

});


server.get('/api/queues/items/_all', function (req, res, next){
  var limit = req.query.limit || 10;
  var offset = req.query.offset || 0;
  getMessagesInQueue(config.name, config.queue, offset, limit, function (err, data){
    if (err) return next(new errors.InternalError(err));


    var objectResponse = [];

    async.eachLimit(data, 10, function (item, next){
      getMessageByID(config.name, config.queue, item, function (err, data){
        getMessageMetadataByFileID(data.fileID, function (err, metadata){
          objectResponse.push({
            messageID : item,
            message : data,
            metadata : metadata
          });
          next();
        });
      });
    }, function (err){

      res.send({
        data : objectResponse,
        queue : config.queue
      })
    })





  });

});

server.get('/api/queues/items/_count', function (req, res, next){
  var limit = req.query.limit || 10;
  var offset = req.query.offset || 0;

  countMessages(config.name, config.queue, function (err, data){
    return reply(err, res, data)
  });
});


server.get('/api/queues/status/:fileID', function (req, res, next){
  var limit = req.query.limit || 10;
  var offset = req.query.offset || 0;


  getMessageMetadataByFileID(req.params.fileID, function (err, response){
    if (err) return next(new errors.InternalError(err));

    var obj = {};

    for (var key in response){
      obj[key] = deCodeJSON(response[key]);
    }

    res.send({
      data : obj,
      queue : config.queue
    });

  });

});
server.get('/api/queues/items/:messageID', function (req, res, next){
  var limit = req.query.limit || 10;
  var offset = req.query.offset || 0;

  getMessageByID(config.name, config.queue,req.params.messageID, function (err, message){
    if (err) return next(new errors.InternalError(err));

    console.log(err, message);

    if (!message){
      return next(new errors.NotFoundError('Item not found'));
    }

    getMessageMetadataByFileID(message.fileID, function (err, metadata){
      if (err) return next(new errors.InternalError(err));
      console.log(err, metadata)
      message.metadata = metadata;
      res.send({
        data : message,
        queue : config.queue
      })
    });
  });
});


server.get('/api/queues/items/:messageID/metadata', function (req, res, next){
  var limit = req.query.limit || 10;
  var offset = req.query.offset || 0;

  getMessageMetadataByID(config.name, config.queue,req.params.messageID, function (err, data){
    return reply(err, res, data);
  });
});
server.get('/api/queues/_metadata', function (req, res, next){
  getQueueMetadata(config.name, config.queue, function (err, data){
    return reply(err, res, data);
  });
});


server.get('/api/socket', function (req, res, next){
  var limit = req.query.limit || 10;
  var offset = req.query.offset || 0;

  res.send('OK');
});


var clients = {};

io.sockets.on('connection', function (socket) {
  var socketID = socket.id;
  clients[socketID] = socket;

  console.log('Client connected',socketID )

  socket.on('disconnect', function (a,b,c) {
    var d = new Date().toISOString();

    console.log(`${d} - Client disconnect ${socketID}`);

    delete clients[socketID];
  });

});


sub.subscribe(config.status.channel);
sub.on('subscribe', function (){
  console.log('Connected to channel', config.status.channel);

});

sub.on('message', function (channel, json){

  var message = JSON.parse(json);

  broadCast(clients, message);
});


function broadCast(clients, eventData){
  Object.keys(clients).forEach(function (socketID){
    var socket = clients[socketID];
    socket.emit('REDIS_PUBLISH', eventData);
  });
}


server.listen(config.api.port, function () {
    console.log('socket.io server listening at %s', server.url);
});

//GET /api/queues/<queuename>/
//GET /api/queues/<queuename>/<id>
//GET /api/queues/<queuename>/<id>/metadata
