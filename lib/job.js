const request = require('request');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

module.exports = class Job {
  constructor({ host, proxy }, files, opts) {
    let options = opts || {};

    if (typeof files === 'string') {
      this.files = [files];
    } else if (typeof files === 'object' && !Array.isArray(files) && !(files instanceof Readable)) {
      options = files;
      this.files = [];
    } else {
      this.files = files;
    }


    this.host = host;
    this.proxy = proxy;
    this.headers = options.headers || {};

    if (options.settings) {
      this.settings(options.settings);
    }
  }

  setHeader(name, value) {
    this.headers[name] = value;
    return this;
  }

  getHeader(name) {
    return this.headers[name];
  }

  settings(name) {
    this.headers['ezpaarse-predefined-settings'] = name;
    return this;
  }

  addFile(file) {
    this.files.push(file);
    return this;
  }

  download(filename) {
    if (!this.id) {
      throw new Error('The job has no ID');
    }

    return request({ method: 'GET', uri: `http://${this.host}/${this.id}/${filename}` });
  }

  start() {
    const requestOptions = {
      method: 'POST',
      uri: `http://${this.host}`,
      headers: this.headers,
      proxy: this.proxy,
    };

    if (this.files instanceof Readable) {
      requestOptions.body = this.files;
    } else if (Array.isArray(this.files) && this.files.length > 0) {
      requestOptions.formData = {
        attachments: this.files.map(f => fs.createReadStream(path.resolve(f))),
      };
    } else {
      throw new Error('no log files provided');
    }

    return new Promise((resolve, reject) => {
      const req = request.post(requestOptions);

      req.on('error', reject);
      req.on('response', (response) => {
        response.pause();
        this.id = response.headers['job-id'];
        req.removeListener('error', reject);
        resolve(response);
      });
    });
  }
};
