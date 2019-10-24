const fs = require('fs');
const path = require('path');
const ezpaarse = require('../..');
const { coerceHeaders, coerceDownloads } = require('../../lib/utils');
const logger = require('../../lib/logger')({ stdout: process.stderr });

exports.command = 'process [files..]';
exports.aliases = ['p'];
exports.desc = 'Process a set of files';

exports.builder = (yargs) => yargs
  .option('o', {
    alias: ['out', 'output'],
    describe: 'Output file',
    coerce: (file) => path.resolve(file),
  })
  .option('H', {
    alias: ['header', 'headers'],
    describe: 'Add a header to the request',
    coerce: coerceHeaders,
  })
  .option('d', {
    alias: 'download',
    describe: 'Download a file from the job directory',
    coerce: coerceDownloads,
  })
  .option('v', {
    alias: ['verbose'],
    describe: 'Shows detailed operations',
    boolean: true,
  })
  .option('s', {
    alias: 'settings',
    describe: 'Set a predefined setting',
  });

exports.handler = async (argv) => {
  const input  = argv.files || process.stdin;
  const client = ezpaarse.Client({ host: argv.host, proxy: argv.proxy });
  const job    = client.createJob(input, {
    settings: argv.settings,
    headers: argv.headers,
  });
  const startTime  = process.hrtime();
  const outputFile = argv.output ? path.resolve(argv.output) : null;

  logger.setVerbose(!!argv.verbose);

  let hasError = false;
  let response;

  try {
    response = await job.start();
  } catch (e) {
    if (e.code === 'ECONNREFUSED') {
      logger.error(`${e.address}:${e.port} does not respond`);
      process.exit(1);
    }

    const res = e.response || {};
    const ezpaarseMessage = res && res.headers && res.headers['ezpaarse-status-message'];
    logger.error(`The job failed with status ${res.status || 'N/A'} ${res.statusText || 'N/A'}`);

    if (ezpaarseMessage) {
      logger.error(`ezPAARSE message : ${ezpaarseMessage}`);
    }

    process.exit(1);
  }

  logger.verbose(`Job started (ID: ${job.id || 'n/a'})`);

  try {
    await new Promise((resolve, reject) => {
      if (outputFile) {
        response.data.pipe(fs.createWriteStream(outputFile))
          .on('error', reject)
          .on('finish', resolve);
      } else {
        response.data.pipe(process.stdout, { end: false });
        response.data.on('error', reject);
        response.data.on('end', resolve);
      }
    });

    if (!response.data.complete) {
      throw new Error('unexpected disconnection');
    }
  } catch (e) {
    hasError = true;
    logger.error(`The job has been interrupted : ${e.message}`);
  }

  if (argv.download) {
    for (const fileDownload of argv.download) {
      const { filename } = fileDownload;
      let { dest } = fileDownload;

      if (dest) {
        dest = path.resolve(dest);
      } else if (outputFile) {
        dest = outputFile.replace(/(\.[a-z]{2,4})?$/i, `.${filename}`);
      } else {
        dest = path.resolve(filename);
      }

      logger.verbose(`Downloading ${filename} into ${dest}`);

      try {
        await downloadFile(job, filename, dest);
      } catch (e) {
        hasError = true;
        logger.error(`Failed to download ${filename}`);
      }
    }
  }

  const elapsed = process.hrtime(startTime)[0];
  logger.verbose(`Job terminated in ${elapsed}s`);

  process.exit(hasError ? 1 : 0);
};

/**
 * Download a file from the job directory to a given path
 * @param {Object} job the job to download the file
 * @param {string} filename the file to download
 * @param {string} dest the place to store the file to
 */
async function downloadFile(job, filename, dest) {
  if (!job.id) {
    return Promise.reject(new Error('Job has no ID'));
  }

  const response = await job.download(filename);

  return new Promise((resolve, reject) => {
    response.data
      .pipe(fs.createWriteStream(dest))
      .on('error', reject)
      .on('finish', resolve);
  });
}
