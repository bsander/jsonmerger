module.exports = function jsonMerger(files, options) {
  'use strict';

  var os = require('os');
  var _ = require('lodash');
  var traverse = require('traverse');

  var dJSON = require('djson');

  var config = {};

  function init() {
    options = _.defaults(options || {}, {
      wildcard: '*',
      strategy: defaultStrategy,
      preprocess: defaultPreProcess,
      deleteNullValues: true
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

  function defaultPreProcess(config) {
    var preprocess = config._preprocess;
    delete config._preprocess;

    switch (preprocess) {
    case 'stages':
      return preProcessStageConfig(config);
    default:
      return config;
    }
  }

  function preProcessStageConfig(config) {
    var merged = {};
    var hostname = os.hostname();
    // I am assuming here that _.each iterates in the same order as the object
    // was constructed. This appears to be valid, but is as of yet still
    // unconfirmed.
    _.each(config, function (stage) {
      _.merge(wrap(merged), wrap(stage.config), options.strategy);
      // return false when hostname is matched; short-circuiting further
      // iteration
      return !_.contains(stage.hosts || [], hostname);
    });
    return merged;
  }

  // Returning `undefined` means merging is performed at the discretion of
  // `_.merge`.
  function defaultStrategy(a, b) {
    if (!_.isPlainObject(b)) {
      // Cannot read a directive from this so just continue to merge natively
      return undefined;
    }

    a = prepareInstances(a, b);

    var strategy = getStrategy(b._strategy);
    delete b._strategy;
    return strategy(a, b);
  }

  function getStrategy(strategy) {
    switch (strategy) {
    case 'noconcat':
      // Regular merge, but replace arrays entirely instead of by element
      return noConcatStrategy;
    case 'replace':
      // Replace the entire old value with the new one
      return replaceStrategy;
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

  function prepareInstances(a, b) {
    // Only act when we encounter an `instances` block
    if (!((a && a._instances) || b._instances)) {
      return a;
    }

    // ensure we are working with comparable objects
    if (!_.isPlainObject(a)) {
      a = {};
    }

    // Ensure the `_instances` directive doesn't get merged
    delete a._instances;
    delete b._instances;

    // Ensure a wildcard object is present in `a` for the initial merge
    a[options.wildcard] = a[options.wildcard] || {};

    // Merge each property of a with the wildcard value
    a = _.mapValues(a, function (value) {
      var wildcard = _.cloneDeep(b[options.wildcard] || {});
      return unwrap(_.merge(wrap(value), wrap(wildcard), options.strategy));
    });

    // Initialize each new property with the previously merged wildcard value.
    var newKeys = _.difference(_.keys(b), _.keys(a));
    _.each(newKeys, function (key) {
      a[key] = unwrap(_.merge(wrap({}), wrap(a[options.wildcard]), options.strategy));
    });

    // Drop the wildcard from `b` since it is already fully merged
    delete b[options.wildcard];

    // Keep `_instances` directive for future merges
    a._instances = true;

    return a;
  }

  function deleteStrategy() {
    // Do not return `undefined` because `_.merge` will take that as a hint to
    // do a merge of it's own. `null` is the next best thing.
    return null;
  }

  function replaceStrategy(a, b) {
    // Replace `a` by merging onto an empty object (this processes nested
    // strategy directives)
    return unwrap(_.merge(wrap({}), wrap(b), options.strategy));
  }

  function concatenateArraysStrategy(a, b) {
    return arrayStrategy(a, b, true);
  }

  function noConcatStrategy(a, b) {
    return arrayStrategy(a, b, false);
  }

  function arrayStrategy(a, b, concat) {
    if (!_.isPlainObject(a)) {
      // a is not an object and will therefore be replaced
      return replaceStrategy(a, b);
    }
    _.each(b, function (value, key) {
      if (_.isArray(a[key]) && _.isArray(value)) {
        // Concatenate or replace arrays
        a[key] = concat ? a[key].concat(value) : value;
        return;
      }
      if (_.isPlainObject(value)) {
        // Recursively merge nested object
        var obj = {};
        obj[key] = value;
        // assign the value because `a` may not have been an object.
        a = _.merge(a, obj, options.strategy);
        return;
      }
      // Assign primitive value
      a[key] = value;
    });
    return a;
  }

  /*
   * These `wrap` and `unwrap` helper methods are neede because `_.merge`
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
    return unwrap(_.merge(wrap(merged), wrap(single), options.strategy));
  }

  function requireUncached(file) {
    // A little verbose due to unit test compatibility
    var resolved;
    try {
      resolved = require.resolve(file);
    } catch (e) {}
    if (resolved) {
      delete require.cache[resolved];
    }
    return require(file);
  }

  function cleanInstances() {
    config = unwrap(traverse(wrap(config)).map(function (node) {
      if (node === null && options.deleteNullValues) {
        return this.remove();
      }
      if (_.isPlainObject(node) && node._instances) {
        delete node._instances;
        delete node[options.wildcard];
        this.update(node);
      }
    }));
  }

  function mergeFiles() {
    var configs = _.map(files, requireUncached);
    config = _.reduce(configs, mergeSingleConfig, {});
    // Finally delete the `*` instance and the `_instances` directive so that
    // all actual instances can be iterated over by the code.
    cleanInstances();
  }

  init();
  return config;
};
