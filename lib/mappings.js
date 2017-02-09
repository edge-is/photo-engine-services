var obj = {
  image: {
      properties: {
          "BitsPerSample": {
              "type": "long"
          },
          "CaptionWriter": {
              "type": "string",
              "fields": {
                  "raw" : {
                    "type": "string",
                    "index": "not_analyzed"
                  }
              }
          },
          "Category": {
              "type": "string",
              "boost" : 1.2,
              "fields": {
                  "raw" : {
                    "type": "string",
                    "index": "not_analyzed"
                  }
              }
          },
          "City": {
              "type": "string",
              "boost" : 1.2
          },
          "ColorComponents": {
              "type": "long"
          },
          "ColorMode": {
              "type": "string",
              "fields": {
                  "raw" : {
                    "type": "string",
                    "index": "not_analyzed"
                  }
              }
          },
          "ColorSpaceData": {
              "type": "string"
          },
          "Comment": {
              "type": "string",
              "boost" : 1.5
          },
          "CopyrightFlag": {
              "type": "boolean"
          },
          "CopyrightNotice": {
              "type": "string"
          },
          "Country": {
              "type": "string"
          },
          "CountryCode": {
              "type": "string"
          },
          "CreatorTool": {
              "type": "string"
          },
          "Credit": {
              "type": "string",
              "fields": {
                  "raw" : {
                    "type": "string",
                    "index": "not_analyzed"
                  }
              }
          },
          "DateCreated": {
              "type": "date",
              "format": "epoch_millis",
              "boost" : 1.3
          },
          "Description": {
              "type": "string",
              "boost" : 1.6,
              "fields": {
                  "raw" : {
                    "type": "string",
                    "index": "not_analyzed"
                  }
              }
          },
          "DeviceAttributes": {
              "type": "string"
          },
          "Directory": {
              "type": "string"
          },
          "EncodingProcess": {
              "type": "string"
          },
          "ExifImageHeight": {
              "type": "integer"
          },
          "ExifImageWidth": {
              "type": "integer"
          },
          "ExifToolVersion": {
              "type": "double",
              "index" : "no"
          },
          "FileName": {
              "type": "string"
          },
          "FileSize": {
              "type": "string"
          },
          "FileType": {
              "type": "string"
          },
          "HasCrop": {
              "type": "boolean",
              "index" : "no"
          },
          "ImageHeight": {
              "type": "integer"
          },
          "ImageSize": {
              "type": "string"
          },
          "ImageWidth": {
              "type": "integer"
          },
          "Instructions": {
              "type": "string",
              "fields": {
                  "raw" : {
                    "type": "string",
                    "index": "not_analyzed"
                  }
              }
          },
          "Keywords": {
              "type": "string",
              "boost" : 1.7
          },
          "MIMEType": {
              "type": "string"
          },
          "ObjectName": {
              "type": "string"
          },
          "ObjectTypeReference": {
              "type": "string",
              "boost" : 1.2
          },
          "Orientation": {
              "type": "string"
          },
          "OriginatingProgram": {
              "type": "string"
          },
          "PhotometricInterpretation": {
              "type": "string"
          },
          "ProfileConnectionSpace": {
              "type": "string"
          },
          "ProfileDateTime": {
              "type": "date",
              "format": "epoch_millis"
          },
          "ProfileFileSignature": {
              "type": "string"
          },
          "ReleaseDate": {
              "type": "date",
              "format": "epoch_millis"
          },
          "RenderingIntent": {
              "type": "string"
          },
          "ResolutionUnit": {
              "type": "string"
          },
          "Rights": {
              "type": "string",
              "fields": {
                  "raw" : {
                    "type": "string",
                    "index": "not_analyzed"
                  }
              }
          },
          "Source": {
              "type": "string"
          },
          "SourceFile": {
              "type": "string"
          },
          "SpecialInstructions": {
              "type": "string"
          },
          "State": {
              "type": "string",
              "boost" : 1.3
          },
          "Subject": {
              "type": "string",
              "boost" : 1.6,
              "fields": {
                  "raw" : {
                    "type": "string",
                    "index": "not_analyzed"
                  }
              }
          },
          "SupplementalCategories": {
              "type": "string",
              "boost" : 1.3
          },
          "name_hash" : {
            "type": "string",
            "index": "not_analyzed"
          },
          "Title": {
              "type": "string",
              "boost" : 1.3,
              "fields": {
                  "raw" : {
                    "type": "string",
                    "index": "not_analyzed"
                  }
              }
          },
          "UserDefined3": {
              "type": "string",
              "boost" : 1.6
          },
          "XMPFileStamps": {
              "type": "long"
          },
          "XResolution": {
              "type": "integer"
          },
          "YResolution": {
              "type": "integer"
          },
          "archive": {
              "type": "string",
              "boost" : 1.5,
              "fields": {
                  "raw" : {
                    "type": "string",
                    "index": "not_analyzed"
                  }
              }
          },
          "archive_id" : {
            "type": "string",
            "index": "not_analyzed"
          }
      }
  }
};


module.exports = obj;
