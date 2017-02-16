

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


server.get('/api/queues', function (req, res, next){
  var limit = req.query.limit || 10;
  var offset = req.query.offset || 0;
  getMessagesInQueue(config.name, config.queue, offset, limit, function (err, data){
    return reply(err, res, data)
  });

});

server.get('/api/queues/_count', function (req, res, next){
  var limit = req.query.limit || 10;
  var offset = req.query.offset || 0;

  countMessages(config.name, config.queue, function (err, data){
    return reply(err, res, data)
  });
});
server.get('/api/queues/:messageID', function (req, res, next){
  var limit = req.query.limit || 10;
  var offset = req.query.offset || 0;

  getMessageByID(config.name, config.queue,req.params.messageID, function (err, data){
    return reply(err, res, data)
  });
});


server.get('/api/queues/:messageID/metadata', function (req, res, next){
  var limit = req.query.limit || 10;
  var offset = req.query.offset || 0;

  getMessageMetadataByID(config.name, config.queue,req.params.messageID, function (err, data){
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

sub.on('message', function (channel, message){
  broadCast(clients, message);
});


function broadCast(clients, eventData){
  console.log('BROADCAST');
  Object.keys(clients).forEach(function (socketID){
    var socket = clients[socketID];
    console.log('Broadcasting to client', 'REDIS_PUBLISH',  socket.id);
    socket.emit('REDIS_PUBLISH', eventData);
  });
}


server.listen(config.api.port, function () {
    console.log('socket.io server listening at %s', server.url);
});

//GET /api/queues/<queuename>/
//GET /api/queues/<queuename>/<id>
//GET /api/queues/<queuename>/<id>/metadata
