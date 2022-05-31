const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { Readable } = require('stream');

axios.defaults.headers.common.Accept = 'text/csv';

module.exports = class Job {
  constructor({ host, proxy }, files, opts) {
    const options = opts || {};

    if (!files) {
      this.files = [];
    } else if (typeof files === 'string') {
      this.files = [files];
    } else if (Array.isArray(files) || files instanceof Readable) {
      this.files = files;
    }

    this.host = host;
    this.proxy = proxy;
    this.headers = options.headers || {};
    this.id = options.id;

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

    return axios.request({
      url: `http://${this.host}/${this.id}/${filename}`,
      proxy: this.proxy,
      responseType: 'stream',
    });
  }

  start() {
    const requestOptions = {
      method: 'POST',
      url: `http://${this.host}/${this.id || ''}`,
      headers: this.headers,
      proxy: this.proxy,
      responseType: 'stream',
      maxRedirects: 0,
      validateStatus: (status) => status === 200,
    };

    if (this.files instanceof Readable) {
      requestOptions.data = this.files;
    } else if (Array.isArray(this.files) && this.files.length > 0) {
      const formData = new FormData();

      this.files.forEach((f) => {
        const filePath = path.resolve(f);
        formData.append(path.basename(f), fs.createReadStream(filePath));
      });

      requestOptions.headers = {
        ...requestOptions.headers,
        ...formData.getHeaders(),
      };

      requestOptions.data = formData;
    } else {
      throw new Error('no log files provided');
    }

    return axios.request(requestOptions).then((response) => {
      this.id = response.headers && response.headers['job-id'];
      return response;
    }).catch((err) => {
      this.id = err.response && err.response.headers && err.response.headers['job-id'];
      return Promise.reject(err);
    });
  }
};
