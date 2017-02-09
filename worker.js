
var _utils = require('./lib/utils.js');
var Workers = require('./lib/workers.js');

var converter = require('./lib/converter.js');

var configFile = __dirname + '/config.yml';

var argv = require('yargs').argv;

configFile = (typeof argv.c === 'string') ? argv.c : configFile;
var config = _utils.readConfig(configFile);


var rsmq =  _utils.rsmq(config);

var workers = new Workers(config);

var init = workers.init();

var type = argv.t || process.env.TYPE || false;

init.on('ready', function (){
  var _worker = false;
  switch (type) {
    case 'index':
      _worker = workers.getWorker('index');
      break;
    case 'sync':
      _worker = workers.getWorker('sync');
      break;
    case 'thumbnail':
      _worker = workers.getWorker('thumbnail');
      break;
    default:
      _worker = false;
  }

  if (!_worker){
    return console.log(`${type} is not a valid worker type`);
  }

  console.log(`Starting a worker, type: ${type}`);

  _worker(function (err, message, next){
    console.log(`${type} got a message...`, message.info);

    setTimeout(next, 100);
  });
});
