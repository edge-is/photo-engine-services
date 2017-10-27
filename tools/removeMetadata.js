const fs = require('fs');
const path = require('path');
const async = require('async');

const argv = require('yargs').argv;

const XMP = require('../lib/xmp.js');
const humanSize = require('human-size');




const inputFile = argv.file;
const outputFolder = argv.out || '.';

const date = argv.d || 'NOT A DATE';

const dry = argv.n || argv.dry || false;

const list = argv.list || false;

if (!date){

  console.log(`No date specified, used -d '<date>'`)
  return process.exit(1);
}

const dateToCutAt = new Date(argv.d);


if ( dateToCutAt.toString() === 'Invalid Date'){
  console.log(`the date ${argv.d} is not a valid date`);
  return process.exit(1);
}



if (!inputFile && !list){
  console.log(`I need a file please :) --file '<filename>' or a list --list '<filelist>'`)
  return process.exit(1);
}



const now = new Date();

const timeString = now.toISOString()
                      .split('T')
                      .shift();


const xmp = new XMP();


if (inputFile){
  removeMetadata(inputFile, outputFolder);
}

if (list){
  console.log(`Reading ${list}`);
  var array = fs.readFileSync(list).toString('utf-8').split('\r\n');
  array = array.filter(function (item){
    return (item.length > 1);
  });
  let i = 1;
  async.forEachLimit(array, 1, function (file, next){
    console.log(`Reading file ${file} :: ${i}/${array.length}`);

    removeMetadata(file, outputFolder, next);
    i++;
  }, function done(){
    console.log(`All files done`);
  })
}



function removeMetadata(input, outputFolder, callback){
  const parsed = path.parse(input);
  const newFileName = [ parsed.name, timeString].join('.') + parsed.ext

  const outputFile = path.join(outputFolder, newFileName);

  callback = callback || function (){};
  fs.readFile(input, function (err, buffer){
    if (err) {
      console.error(`Could not read ${input}`, err);
      return callback(err);
    }
    let size = humanSize(buffer.length);
    console.log(`Done reading ${input} into memory, ${size} bytes`);

    xmp.read(buffer).then(function (arr){

      let cutAtIndex = arr.reverse().findIndex(function (meta){
        return (dateToCutAt > meta.CreateDate);
      });

      if (cutAtIndex <= 0){
        console.error(`Cannot find metadata older than ${dateToCutAt}`);
        return callback();
      }

      if (dry){
         console.log(`Would remove ${cutAtIndex}  metadata records but this is a dry run`)
         return callback();
      }

      sliceIndexAtMetadataCount(buffer, cutAtIndex, function (newFileBuffer){
        let diff = humanSize(buffer.length - newFileBuffer.length);

        console.log(`Will remove ${cutAtIndex} metadata records from file and ${diff}`)

        fs.writeFile(outputFile, newFileBuffer, function (err){
          if (err){

            console.error('Error writing file to disk', err);
            return callback(err);
          }

          console.log(`Wrote file to disk '${outputFile}'`);
          callback(null);
        });
      });
    }, function errorXMP(err){
      console.log(`Error reading XMP data`, err);
    });
  });
}

function sliceIndexAtMetadataCount(buffer, cutAt, callback){
  const originalBuffer = new Buffer.from(buffer);

  const len = buffer.length;

  const inspecString = '</x:xmpmeta>';
  const inspectSize = new Buffer(inspecString).length;
  let found = -1;

  for (var i = 1 ; i < len; i ++){
    let end = len - i;

    let index = end - inspectSize;


    let part = buffer.slice(index, end).toString('utf-8');

    if (part.indexOf(inspecString) > -1){

      found++;

      if (found === cutAt ){
        let newFileBuffer = originalBuffer.slice(0, end);
        return callback(newFileBuffer);

      }
    }

  }
}
