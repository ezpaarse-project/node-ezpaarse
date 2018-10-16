const fs = require('fs');
const path = require('path');
const ezpaarse = require('../..');
const { coerceHeaders, coerceDownloads, pick } = require('../../lib/utils');
const logger = require('../../lib/logger')({ stdout: process.stderr });

exports.command = 'process [files..]';
exports.aliases = ['p'];
exports.desc = 'Process a set of files';

exports.builder = yargs => yargs
  .option('o', {
    alias: ['out', 'output'],
    describe: 'Output file',
    coerce: file => path.resolve(file),
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
  const input      = argv.files || process.stdin;
  const client     = ezpaarse.Client(pick(argv, ['host', 'proxy']));
  const job        = client.createJob(input, pick(argv, ['settings', 'headers']));
  const startTime  = process.hrtime();
  const outputFile = argv.output ? path.resolve(argv.output) : null;
  const hasError   = false;

  const { verbose } = argv;
  let response;

  try {
    response = await job.start();
  } catch (e) {
    if (e.code === 'ECONNREFUSED') {
      logger.error(`${e.address}:${e.port} does not respond`);
    } else {
      logger.error(e.message);
    }
    process.exit(1);
  }

  if (verbose) {
    logger.info(`Job started (ID: ${job.id || 'n/a'})`);
  }

  if (response.statusCode !== 200) {
    const ezpaarseMessage = response.headers['ezpaarse-status-message'];
    logger.error(`The job failed with status ${response.statusCode} ${response.statusMessage}`);
    if (ezpaarseMessage) { logger.error(`ezPAARSE message : ${ezpaarseMessage}`); }
    process.exit(1);
  }

  const output = outputFile ? fs.createWriteStream(outputFile) : process.stdout;

  try {
    await new Promise((resolve, reject) => {
      response.on('end', resolve);
      response.on('error', reject);
      response.pipe(output);
    });
  } catch (e) {
    hasError = true;
    logger.error(`The job has been interrupted : ${e.message}`);
  }

  if (argv.download) {
    for (let { filename, dest } of argv.download) {

      if (dest) {
        dest = path.resolve(dest);
      } else if (outputFile) {
        dest = outputFile.replace(/(\.[a-z]{2,4})?$/i, `.${filename}`);
      } else {
        dest = path.resolve(filename);
      }

      if (verbose) {
        logger.info(`Downloading ${filename} into ${dest}`);
      }

      try {
        await download(job, filename, dest);
      } catch (e) {
        hasError = true;
        logger.error(`Failed to download ${filename}`);
      }
    }
  }

  if (verbose) {
    const elapsed = process.hrtime(startTime)[0];
    logger.info(`Job terminated in ${elapsed}s`);
  }

  process.exit(hasError ? 1 : 0);
};

/**
 * Download a file from the job directory to a given path
 * @param {Object} job the job to download the file
 * @param {string} filename the file to download
 * @param {string} dest the place to store the file to
 */
function download(job, filename, dest) {
  return new Promise((resolve, reject) => {
    if (!job.id) {
      reject(new Error('Job has no ID'));
      return;
    }

    job.download(filename)
      .pipe(fs.createWriteStream(dest))
      .on('error', reject)
      .on('finish', resolve);
  });
}
