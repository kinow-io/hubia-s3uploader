/*
* S3Uploader
*
* Copyright 2020, Kinow, contact@kinow.com
* Version: 0.1.0
*
*/
(function() {

    var uploadId = 0;
    var storedFiles = [];

    "use strict";
    /**
    * S3MultiPartUpload
    *
    * @param {object} params - The params object
    */
    function S3MultipartUpload(options) {

        if (!(this instanceof S3MultipartUpload)) {
            return new S3MultipartUpload(files, options);
        }

        if (options && typeof options === "object") {
            this.options = extend(this.options, options);
        }

        this.log('Options:', this.options);
    }

    S3MultipartUpload.prototype.options = {
        logging: false,
        chunkedFile : true,
        partSize: 5 * 1024 * 1024,
        maxSize: 500 * 1024 * 1024 * 1024,
        maxFilesConcurency: 5,
        temporaryCredentials: true,
        temporaryCredentialsLocation: 'credentials.php',
        bucket: 'undefined',
        bucketFolder: '',
        acl: 'private',
        accessKeyId: 'undefined',
        region: 'undefined',
        signatureVersion: 'v4',
        apiVersion: '2006-03-01'
    };

    S3MultipartUpload.prototype.init = function (files) {

        if (window.File && window.FileReader && window.FileList && window.Blob) {

            this.files = Array.prototype.slice.call(files);
            this.log('Start Files:', this.files);
            this.initiateS3Params();
        } else {
            this.error('The File APIs are not fully supported in this browser.');
        }
    };

    S3MultipartUpload.prototype.initiateS3Params = function () {
        this.log('initiateS3Params');

        if (this.options.temporaryCredentials)
            this.initiateMultiPartUpload();
        else
        {
            upload.s3Params.AccessKeyId = this.options.accessKeyId;
            upload.s3Params.SecretAccessKey = this.options.secretAccessKey;
            upload.s3Params.SessionToken = '';
            this.initiateMultiPartUpload();
        }
    };

    S3MultipartUpload.prototype.initiateMultiPartUpload = function () {
        var self = this;

        self.files.forEach(function (file) {
            uploadId++
            if (self.checkFile(file)) {
                self.error('Error with filename');
                return;
            } else {
                var upload = new FileUpload(self, file, uploadId);
                self.getTemporaryCredentials(upload);
            };
        });
    };

    S3MultipartUpload.prototype.getTemporaryCredentials = function (upload) {
        var self = this;

        var params = '&key=' + upload.file.name + '&size=' + upload.file.size + '&type=' + upload.file.type;
        var xhr = new XMLHttpRequest();

        // Setup request
        xhr.open('POST', self.options.temporaryCredentialsLocation, true);
        xhr.setRequestHeader('Content-type', 'application/x-www-form-urlencoded');

        // Result behavior
        xhr.onreadystatechange = function(e) {
            if (xhr.readyState == 4 && xhr.status == 200) {
                upload.s3Params = JSON.parse(xhr.response).params;
                self.log('getTemporaryCredentials:', upload.s3Params);
                self.newS3Client(upload);
                self.start(upload.fileId, upload.file.name, upload.file.size);
            } else if (xhr.readyState == 4 && xhr.status != 200) return self.error('Error when getting temporary credentials');
        };

        // Send request
        xhr.send(params);
    };

    S3MultipartUpload.prototype.newS3Client = function (upload) {

        upload.S3Client = new AWS.S3({
            params: {
                Bucket: upload.s3Params.bucket,
                ACL: this.options.acl,
                Key: upload.s3Params.Key,
            },
            httpOptions: {
                timeout: 0
            },
            apiVersion: this.options.apiVersion,
            region: upload.s3Params.region,
            accessKeyId:  upload.s3Params.AccessKeyId,
            secretAccessKey: upload.s3Params.SecretAccessKey,
            sessionToken: upload.s3Params.SessionToken,
            signatureVersion: this.options.signatureVersion,
        });

        this.log('connected to S3 Client');
        this.createMultipartUpload(upload);
    };

    S3MultipartUpload.prototype.createMultipartUpload = function (upload) {

        var self = this;

        var params = {
            ContentType: upload.file.type,
            RequestPayer: 'requester',
            ServerSideEncryption: 'AES256',
            StorageClass: 'REDUCED_REDUNDANCY',
        };

        upload.S3Client.createMultipartUpload(params, function(err, multipart) {
            if (err) { self.error(err); return; }

            storedFiles.push({ id: upload.fileId, key: upload.s3Params.Key, s3: upload.S3Client, uploadId: multipart.UploadId, status: 'uploading' });

            self.log('Multipart created for filename', multipart.Key);
            upload.status = 'uploading';
            setTimeout(function(){ self.uploadPart(multipart, upload, upload.fileId); }, 1000);
        });
    };

    S3MultipartUpload.prototype.uploadPart = function (multipart, upload, fileId) {

        var self = this;
        var file = this.findUploadById(fileId);

        if (file.status == 'uploading') {

            var blob = upload.blobs[upload.currentPart];

            upload.currentPart++;
            this.log('Upload Part #' + upload.currentPart + ' for ', multipart.Key);

            partParams = {
                Body: blob,
                //Key: file.key,
                PartNumber: upload.currentPart,
                UploadId: file.uploadId,
                ContentLength: blob.size,
                RequestPayer: 'requester',
            };

            upload.S3Client.uploadPart(partParams)

            .on('httpUploadProgress', function (progress, response) {
                if (file.status == 'cancelled') return;
                if (progress.lengthComputable) {
                    upload.progressParts[upload.currentPart - 1] = progress.loaded;
                    self.progress(upload);
                }
            }).send(function (err, data) {
                if (file.status == 'cancelled') return;
                if (err) {
                    self.errorUpload(err);
                    self.cancel(file.id);
                    return;
                }

                self.log('Complete part # '+ upload.currentPart + ' for', multipart.Key);
                upload.eTagParts.Parts[upload.currentPart - 1] = {
                    ETag: data.ETag,
                    PartNumber: upload.currentPart
                };
                if (file.status == 'cancelled') return;
                if (upload.currentPart !== upload.numParts) { self.uploadPart(multipart, upload, fileId); return; }

                var doneParams = {
                    //Key: multipart.Key,
                    MultipartUpload: upload.eTagParts,
                    UploadId: multipart.UploadId,
                    RequestPayer: 'requester'
                };
                if (file.status == 'cancelled') return;
                self.completeMultipartUpload(doneParams, upload);
            });
        };
    };

    S3MultipartUpload.prototype.completeMultipartUpload = function (doneParams, upload) {
        var self = this;

        upload.S3Client.completeMultipartUpload(doneParams, function(err, data) {
            if (err) {
                self.error(err);
                return;
            }
            self.log('Upload completed for', data.Key);
            self.complete(upload.fileId);
        });
    };

    S3MultipartUpload.prototype.abortMultipartUpload = function (file) {

        var self = this;

        var params = {
            //Key: file.s3.config.params.Key,
            UploadId: file.uploadId,
            RequestPayer: 'requester'
        };

        file.s3.abortMultipartUpload(params, function(err, data) {
            if (err) self.error(err);
            self.onCancel(file.id, file.s3.config.params.Key);
        });
    };

    function FileUpload(S3MultipartUpload, file, uploadId) {
        if (!(this instanceof FileUpload)) {
            return new FileUpload(S3MultipartUpload, file, uploadId);
        }

        var upload = this;

        this.file = file;
        this.fileId = uploadId;

        this.blobs = [];

        this.start = 0;
        this.end = S3MultipartUpload.options.partSize;

        this.progressParts = [];
        this.progressTotal = 0;
        this.numParts = Math.ceil(this.file.size / S3MultipartUpload.options.partSize);
        this.currentPart = 0;

        this.status = '';
        this.eTagParts = {
            Parts: []
        };

        for (var i = 0; i < this.numParts; i++) {
            this.progressParts[i] = 0;
        }

        for (this.start = 0; this.start < this.file.size; this.start += S3MultipartUpload.options.partSize) {

            this.end = Math.min(this.start + S3MultipartUpload.options.partSize, this.file.size);
            this.blobs.push(this.file.slice(this.start, this.end));
        }

        FileUpload.prototype = S3MultipartUpload;
    }


    S3MultipartUpload.prototype.start = function (fileId, fileName, fileSize) {
        this.onStart(fileId, fileName, fileSize);
    };

    S3MultipartUpload.prototype.progress = function (upload) {

        for (var i = 0; i < upload.numParts; i++) {
            upload.progressTotal += upload.progressParts[i];
        }
        upload.progressTotal = upload.progressTotal / upload.file.size;

        this.onProgress(upload.fileId, parseInt(upload.progressTotal * 100));
    };

    S3MultipartUpload.prototype.complete = function (fileId) {
        var file = this.findUploadById(parseInt(fileId));
        file.status = 'completed';
        this.onComplete(fileId, file.s3.config.params.Key);
    };

    S3MultipartUpload.prototype.cancel = function (fileId) {

        var file = this.findUploadById(parseInt(fileId));
        file.status = 'cancelled';
        this.abortMultipartUpload(file);
    };

    S3MultipartUpload.prototype.clean = function (fileId) {

        if (fileId) {
            file = this.findUploadById(parseInt(fileId));
            storedFiles = storedFiles.splice(file.id, 1);
            this.onClean(fileId);
        }
        else {
            toDelete = [];
            for (var i in storedFiles) {
                currentI = parseInt(i);
                if (storedFiles[currentI].status == 'completed' || storedFiles[currentI].status == 'cancelled') {
                    toDelete.push(currentI);
                    this.onClean(storedFiles[currentI].id);
                }
            }
            for (var i in toDelete)
                storedFiles = storedFiles.splice(toDelete[parseInt(i)], 1);
        }
    };

    S3MultipartUpload.prototype.error = function (error) {
        this.onError(error);
    };

    S3MultipartUpload.prototype.errorUpload = function (error) {
        this.onErrorUpload(error);
    };

    S3MultipartUpload.prototype.checkFile = function(file) {
        if (typeof file === 'undefined') return true;
        if (typeof file.name === 'undefined') return true;
        else return false;
    };

    S3MultipartUpload.prototype.getBucketPath = function (filename) {

        if (this.options.bucketFolder !== '' || this.options.bucketFolder !== 'undefined') {
            return this.options.bucketFolder + '/' + filename;
        } else { return filename; }
    };

    S3MultipartUpload.prototype.findUploadById = function(id) {
        var uploadObj = storedFiles.find(function(uploadObj) {
            return uploadObj.id === id;
        });
        return uploadObj;
    }

    /**
     * S3MultipartUpload log system
     *
     * @type {HTMLElement} wrapper - The wrapper to append alerts to.
     * @param {string} type - The type of alert.
     * @param {string} message - The alert message.
     */
    S3MultipartUpload.prototype.log = function (msg, param) {
        if (this.options.logging) {
            if (window.console) {
                if (param) console.log(msg, param);
                else console.log(msg);
            }
        }
    };

    /**
    * Extend obj function
    *
    * This is an object extender function. It allows us to extend an object
    * by passing in additional variables and overwriting the defaults.
    */
    function extend(source, properties) {
        for (var property in properties) {
            if (properties.hasOwnProperty(property)) {
                source[property] = properties[property];
            }
        }
        return source;
    }

    if (typeof define === 'function' && define.amd) {
       define(function() {
           return S3MultipartUpload;
       });
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = S3MultipartUpload;
    } else if (typeof window !== 'undefined') {
        window.S3MultipartUpload = S3MultipartUpload;
    }
})();
