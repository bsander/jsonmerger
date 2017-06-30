'use strict';

module.exports = function jsonMerger(files, options) {

  const os = require('os');
  const _ = require('lodash');
  const traverse = require('traverse');

  const dJSON = require('djson');

  let config = {};

  function init() {
    options = _.defaults(options || {}, {
      wildcard: '*',
      strategy: defaultStrategy,
      preprocess: defaultPreProcess,
      deleteNullValues: true,
      stageEnv: 'NODE_ENV'
    });
    mergeFiles();
    addHelperMethods();
  }

  function addHelperMethods() {
    if (!_.isPlainObject(config)) {
      return;
    }
    config.get = _.partial(dJSON.get, config);
    config.set = _.partial(dJSON.set, config);
  }

  function defaultPreProcess(obj) {
    const preprocess = obj._preprocess;
    delete obj._preprocess;

    switch (preprocess) {
      case 'stages':
        return preProcessStageConfig(obj);
      default:
        return obj;
    }
  }

  function preProcessStageConfig(obj) {
    const merged = {};
    const hostname = os.hostname();
    // I am assuming here that _.each iterates in the same order as the object
    // was constructed. This appears to be valid, but is as of yet still
    // unconfirmed.
    _.each(obj, stage => {
      // Don't append a merging strategy here, as this prevents a stage to
      // determine the merging strategy of a property in the default config
      _.merge(wrap(merged), wrap(stage.config));

      // return false when hostname is matched; short-circuiting further
      // iteration
      if (!_.isUndefined(stage.env) && stage.env === process.env[options.stageEnv]) {
        return false;
      }
      if (_.includes(stage.hosts || [], hostname)) {
        return false;
      }
      return true;
    });
    return merged;
  }

  // Returning `undefined` means merging is performed at the discretion of
  // `_.merge`.
  function defaultStrategy(merged, single) {
    if (!_.isPlainObject(single)) {
      // Cannot read a directive from this so just continue to merge natively
      return undefined;
    }

    merged = prepareInstances(merged, single);

    const strategy = getStrategy(single._strategy);
    const result = strategy(merged, single);

    return result;
  }

  function getStrategy(strategy) {
    switch (strategy) {
      case 'noconcat':
        // Regular merge, but replace arrays entirely instead of by element
        return noConcatStrategy;
      case 'replace':
        // Replace the entire old value with the new one
        return replaceStrategy;
      case 'ignore':
        // Leave the current value alone
        return ignoreStrategy;
      case 'delete':
        // Replace the current value with `null`
        return deleteStrategy;
      case 'concat':
      /* falls through */
      default:
        // Regular merge with array concatenation
        return concatenateArraysStrategy;
    }
  }

  function prepareInstances(merged, single) {
    // Only act when we encounter an `instances` block
    if (!(merged && merged._instances || single._instances)) {
      return merged;
    }

    // ensure we are working with comparable objects
    if (!_.isPlainObject(merged)) {
      merged = {};
    }

    // Ensure a wildcard object is present in `merged` for the initial merge
    merged[options.wildcard] = merged[options.wildcard] || {};

    // Merge wildcard value of `single` in each property of `merged`. By doing this the wildcard of `single`
    // is also merged into the wildcard of `merged`.
    merged = _.mapValues(merged, value => {
      const wildcard = _.cloneDeep(single[options.wildcard] || {});
      return unwrap(_.mergeWith(wrap(value), wrap(wildcard), options.strategy));
    });

    /**
     * Initialize each property that is in `single`, but not in `merged` with the wildcard of `merged` (be aware:
     * this wildcard has already been merged with the wildcard of `single` in the step above this one).
     * *
     * This initialization makes sure that each property of `single` uses the wildcard as "starting point" on which
     * it's own properties will be merged.
     */
    const newKeys = _.difference(_.keys(single), _.keys(merged));
    _.each(newKeys, key => {
      merged[key] = unwrap(_.mergeWith(wrap({}), wrap(merged[options.wildcard]), options.strategy));
    });

    /**
     * Ignore `single`'s wildcard in the upcoming merge since it has already been merged onto `merged`.
     * *
     * This ignore will still keep it available for future merges. For example, imagine having a config.js, projects.js
     * and environments.js; after merging projects.js in config.js, the merged wildcard should still be
     * the "starting point" upon which all properties of environments.js should be based.
     */
    if (_.isPlainObject(single[options.wildcard])) {
      single[options.wildcard]._strategy = 'ignore';
    }

    return merged;
  }

  function deleteStrategy() {
    // Do not return `undefined` because `_.merge` will take that as a hint to
    // do a merge of it's own. `null` is the next best thing.
    return null;
  }

  function replaceStrategy(merged, single) {
    // Replace `merged` by merging onto an empty object (this processes nested
    // strategy directives). Remove `single` strategy because it only applies for the current merge.
    delete single._strategy;
    return unwrap(_.mergeWith(wrap({}), wrap(single), options.strategy));
  }

  function ignoreStrategy(merged, single) {
    // Ignore `single` by merging `merged` with an empty object (this processes nested
    // strategy directives). Remove `single` strategy because it only applies for the current merge.
    delete single._strategy;
    return unwrap(_.mergeWith(wrap(merged), wrap({}), options.strategy));
  }

  function concatenateArraysStrategy(merged, single) {
    return arrayStrategy(merged, single, true);
  }

  function noConcatStrategy(merged, single) {
    return arrayStrategy(merged, single, false);
  }

  function arrayStrategy(merged, single, concat) {
    if (!_.isPlainObject(merged)) {
      // a is not an object and will therefore be replaced
      return replaceStrategy(merged, single);
    }
    _.each(single, (value, key) => {
      if (_.isArray(merged[key]) && _.isArray(value)) {
        // Concatenate or replace arrays
        merged[key] = concat ? merged[key].concat(value) : value;
        return;
      }
      if (_.isPlainObject(value)) {
        // Recursively merge nested object
        const obj = {};
        obj[key] = value;
        // assign the value because `merged` may not have been an object.
        merged = _.mergeWith(merged, obj, options.strategy);
        return;
      }
      // Assign primitive value
      merged[key] = value;
    });
    return merged;
  }

  /*
   * These `wrap` and `unwrap` helper methods are needed because `_.merge`
   * doesn't call the strategy callback on the root object to be merged, only
   * on its properties. This way, it is possible to use strategy directives
   * everywhere.
   */
  function wrap(obj) {
    return {
      wrapped: obj
    };
  }

  function unwrap(obj) {
    return obj.wrapped;
  }

  function mergeSingleConfig(merged, single) {
    // Preprocess configuration block as needed
    single = options.preprocess(single);
    // Merge configuration
    return unwrap(_.mergeWith(wrap(merged), wrap(single), options.strategy));
  }

  function requireUncached(file) {
    // A little verbose due to unit test compatibility
    let resolved;
    try {
      resolved = require.resolve(file);
    } catch (e) {
      // eslint-disable-line no-empty
    }
    if (resolved) {
      delete require.cache[resolved];
    }
    return require(file);
  }

  function cleanInstances() {
    // eslint-disable-next-line array-callback-return
    config = unwrap(traverse(wrap(config)).map(function (node) {
      if (node === null && options.deleteNullValues) {
        return this.remove();
      }
      if (_.isPlainObject(node)) {
        if (node._instances) {
          delete node._instances;
          delete node[options.wildcard];
        }

        if (node._strategy) {
          delete node._strategy;
        }

        this.update(node);
      }
    }));
  }

  function mergeFiles() {
    const configs = _.map(files, requireUncached);
    config = _.reduce(configs, mergeSingleConfig, {});
    // Finally delete the `*` instance and the `_instances` directive so that
    // all actual instances can be iterated over by the code.
    cleanInstances();
  }

  init();
  return config;
};
