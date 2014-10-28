describe('jsonMerger', function () {
  'use strict';

  var chai = require('chai');
  var sinonChai = require('sinon-chai');
  chai.use(sinonChai);
  var expect = chai.expect;
  var sinon = require('sinon');

  var proxyquire = require('proxyquire').noCallThru();
  var os = {
    hostname: sinon.stub().returns('prodhost')
  };

  var jsonMerger;
  var result;
  var dc;
  var ic;
  var ec;
  var dcin;
  var icin;
  var ecin;

  function defaultConfig() {
    return {
      foo: 'default global foo',
      something: 'default global something',
      instances: {
        _instances: 'true',
        '*': {
          x: [0],
          a: 'default * a',
          b: 'default * b',
          c: 'default * c',
          d: 'default * d',
          deeper: {
            zero: 0
          }
        },
        unittest: {
          x: [1],
          b: 'default unittest b',
          c: 'default unittest c',
          d: 'default unittest d',
          deeper: {
            one: 1
          }
        }
      }
    };
  }

  function instancesConfig() {
    return {
      something: 'instances global something',
      instances: {
        '*': {
          x: [2],
          c: 'instances * c',
          d: 'instances * d',
          deeper: {
            two: 2
          }
        },
        unittest: {
          x: [3],
          d: 'instances unittest d',
          deeper: {
            three: 3
          }
        }
      }
    };
  }

  function environmentsConfig() {
    return {
      _preprocess: 'stages',
      prod: {
        hosts: ['prodhost'],
        config: {
          env: 'prod',
          something: 'environments prod global something',
        }
      },
      dev: {
        hosts: ['devhost'],
        config: {
          env: 'dev',
          instances: {
            '*': {
              x: [4],
              a: 'environments dev instances * a',
              deeper: {
                four: 4
              }
            }
          }
        }
      }
    };
  }

  beforeEach(function () {
    result = undefined;
    // Input references
    dcin = defaultConfig();
    icin = instancesConfig();
    ecin = environmentsConfig();
    jsonMerger = proxyquire('../lib/jsonmerger', {
      os: os,
      defaults: dcin,
      instances: icin,
      environments: ecin
    });
    // For easy result comparisons:
    dc = defaultConfig();
    ic = instancesConfig();
    ec = environmentsConfig();
  });
  describe('with a single config file', function () {
    var files = ['defaults'];
    it('should retain all global properties', function () {
      result = jsonMerger(files);
      expect(result.foo).to.deep.equal(dc.foo);
      expect(result.something).to.deep.equal(dc.something);
    });
    it('should drop the `*` instance from the config', function () {
      result = jsonMerger(files);
      expect(Object.keys(result.instances)).to.have.length(1);
      expect(result.instances).to.not.have.key('*');
    });
    it('should properly merge each instance with *', function () {
      result = jsonMerger(files);
      expect(result.instances.unittest).to.deep.equal({
        a: dc.instances['*'].a,
        b: dc.instances.unittest.b,
        c: dc.instances.unittest.c,
        d: dc.instances.unittest.d,
        x: [0, 1],
        deeper: {
          zero: 0,
          one: 1
        }
      });
    });
    it('should add a getter and setter method to the result object', function () {
      result = jsonMerger(files);
      expect(result.get).to.be.a.function;
      expect(result.set).to.be.a.function;
    });
  });
  describe('with two (or more) regular config files', function () {
    var files = ['defaults', 'instances'];
    it('should merge global variables in order', function () {
      result = jsonMerger(files);
      expect(result.foo).to.deep.equal(dc.foo);
      expect(result.something).to.deep.equal(ic.something);
    });
    it('should properly merge the * instances (1)', function () {
      dcin.instances.tmptest = {};

      result = jsonMerger(files);
      expect(result.instances.tmptest).to.deep.equal({
        a: dc.instances['*'].a,
        b: dc.instances['*'].b,
        c: ic.instances['*'].c,
        d: ic.instances['*'].d,
        x: [0, 2],
        deeper: {
          zero: 0,
          two: 2
        }
      });
    });
    it('should properly merge the * instances (2)', function () {
      icin.instances.tmptest = {};

      result = jsonMerger(files);
      expect(result.instances.tmptest).to.deep.equal({
        a: dc.instances['*'].a,
        b: dc.instances['*'].b,
        c: ic.instances['*'].c,
        d: ic.instances['*'].d,
        x: [0, 2],
        deeper: {
          zero: 0,
          two: 2
        }
      });
    });
    it('should properly merge nested * instances', function () {
      dcin.instances['*'].subinstances = {
        _instances: true,
        '*': {
          one: 1,
          two: 2,
          three: 3
        },
        instance: {
          three: 33,
          four: 4
        },
        emptyDefault: {}
      };
      icin.instances['*'].subinstances = {
        '*': {
          two: 22
        },
        instance: {
          four: 44
        },
        newinstance: {
          one: 11,
          five: 5
        },
        emptyInstance: {}
      };
      icin.instances.tmptest = {};

      result = jsonMerger(files);
      expect(result.instances.tmptest.subinstances).to.deep.equal({
        emptyDefault: {
          one: 1,
          two: 22,
          three: 3
        },
        emptyInstance: {
          one: 1,
          two: 22,
          three: 3
        },
        instance: {
          one: 1,
          two: 22,
          three: 33,
          four: 44
        },
        newinstance: {
          one: 11,
          two: 22,
          three: 3,
          five: 5
        }
      });
    });
    it('should drop the `*` instance from the config', function () {
      result = jsonMerger(files);
      expect(Object.keys(result.instances)).to.have.length(1);
      expect(result.instances).to.not.have.key('*');
    });
    it('should merge project instances in correct order', function () {
      result = jsonMerger(files);
      expect(result.instances.unittest).to.deep.equal({
        a: dc.instances['*'].a,
        b: dc.instances.unittest.b,
        c: ic.instances['*'].c,
        d: ic.instances.unittest.d,
        x: [0, 1, 2, 3],
        deeper: {
          zero: 0,
          one: 1,
          two: 2,
          three: 3
        }
      });
    });
    it('should add a getter and setter method to the result object', function () {
      result = jsonMerger(files);
      expect(result.get).to.be.a.function;
      expect(result.set).to.be.a.function;
    });
  });
  describe('with an environments config file', function () {
    var files = ['defaults', 'instances', 'environments'];
    it('should remove the preprocess directive when done', function () {
      result = jsonMerger(files);
      expect(ecin).to.not.have.keys('_preprocess');
      expect(result).to.not.have.keys('_preprocess');
    });
    it('should properly merge the environments file based on host (1)', function () {
      result = jsonMerger(files);
      delete result.get;
      delete result.set;

      expect(result).to.deep.equal({
        env: ec.prod.config.env,
        foo: dc.foo,
        something: ec.prod.config.something,
        instances: {
          unittest: {
            a: dc.instances['*'].a,
            b: dc.instances.unittest.b,
            c: ic.instances['*'].c,
            d: ic.instances.unittest.d,
            x: [0, 1, 2, 3],
            deeper: {
              zero: 0,
              one: 1,
              two: 2,
              three: 3
            }
          }
        },
      });
    });
    it('should properly merge the environments file based on host (2)', function () {
      os.hostname = sinon.stub().returns('devhost');

      result = jsonMerger(files);
      delete result.get;
      delete result.set;

      expect(result).to.deep.equal({
        env: ec.dev.config.env,
        foo: dc.foo,
        something: ec.prod.config.something,
        instances: {
          unittest: {
            a: ec.dev.config.instances['*'].a,
            b: dc.instances.unittest.b,
            c: ic.instances['*'].c,
            d: ic.instances.unittest.d,
            x: [0, 1, 2, 3, 4],
            deeper: {
              zero: 0,
              one: 1,
              two: 2,
              three: 3,
              four: 4
            }
          }
        }
      });
    });
    it('should drop the `*` instance from the config', function () {
      result = jsonMerger(files);
      expect(Object.keys(result.instances)).to.have.length(1);
      expect(result.instances).to.not.have.key('*');
    });
    it('should add a getter and setter method to the result object', function () {
      result = jsonMerger(files);
      expect(result.get).to.be.a.function;
      expect(result.set).to.be.a.function;
    });
  });
  describe('using alternative merge strategy', function () {
    describe('noconcat', function () {
      it('should properly merge each instance with *', function () {
        dcin.instances.unittest._strategy = 'noconcat';
        result = jsonMerger(['defaults']);

        expect(result.instances.unittest).to.deep.equal({
          a: dc.instances['*'].a,
          b: dc.instances.unittest.b,
          c: dc.instances.unittest.c,
          d: dc.instances.unittest.d,
          x: [1],
          deeper: {
            zero: 0,
            one: 1
          }
        });
      });
      it('should properly merge the * instances', function () {
        dcin.instances.tmptest = {};
        icin.instances['*']._strategy = 'noconcat';
        result = jsonMerger(['defaults', 'instances']);

        expect(result.instances.tmptest).to.deep.equal({
          a: dc.instances['*'].a,
          b: dc.instances['*'].b,
          c: ic.instances['*'].c,
          d: ic.instances['*'].d,
          x: [2],
          deeper: {
            zero: 0,
            two: 2
          }
        });
      });
      it('should merge project instances in correct order (1)', function () {
        dcin.instances.unittest._strategy = 'noconcat';
        result = jsonMerger(['defaults', 'instances']);

        expect(result.instances.unittest).to.deep.equal({
          a: dc.instances['*'].a,
          b: dc.instances.unittest.b,
          c: ic.instances['*'].c,
          d: ic.instances.unittest.d,
          x: [1, 2, 3], // 0 was replaced by 1, the rest was properly merged
          deeper: {
            zero: 0,
            one: 1,
            two: 2,
            three: 3
          }
        });
      });
      it('should merge project instances in correct order (2)', function () {
        icin.instances['*']._strategy = 'noconcat';
        result = jsonMerger(['defaults', 'instances']);

        expect(result.instances.unittest).to.deep.equal({
          a: dc.instances['*'].a,
          b: dc.instances.unittest.b,
          c: ic.instances['*'].c,
          d: ic.instances.unittest.d,
          x: [2, 3], // [0,1] was replaced by 2, 3 was concatenated again afterwards
          deeper: {
            zero: 0,
            one: 1,
            two: 2,
            three: 3
          }
        });
      });
      it('should merge project instances in correct order (3)', function () {
        icin.instances.unittest._strategy = 'noconcat';
        result = jsonMerger(['defaults', 'instances']);

        expect(result.instances.unittest).to.deep.equal({
          a: dc.instances['*'].a,
          b: dc.instances.unittest.b,
          c: ic.instances['*'].c,
          d: ic.instances.unittest.d,
          x: [3], // Full replace
          deeper: {
            zero: 0,
            one: 1,
            two: 2,
            three: 3
          }
        });
      });
      it('should properly merge objects from the highest level', function () {
        dcin.y = [0];
        icin.y = [1];
        icin._strategy = 'noconcat';
        result = jsonMerger(['defaults', 'instances']);

        expect(result.y).to.deep.equal([1]);
        expect(result.instances.unittest).to.deep.equal({
          a: dc.instances['*'].a,
          b: dc.instances.unittest.b,
          c: ic.instances['*'].c,
          d: ic.instances.unittest.d,
          x: [0, 1, 2, 3],
          deeper: {
            zero: 0,
            one: 1,
            two: 2,
            three: 3,
          }
        });
      });
      it('should merge deeply nested project instances in correct order', function () {
        dcin.instances.unittest.deeper.y = [0];
        icin.instances.unittest.deeper.y = [1];
        icin.instances.unittest.deeper._strategy = 'noconcat';
        result = jsonMerger(['defaults', 'instances']);

        expect(result.instances.unittest).to.deep.equal({
          a: dc.instances['*'].a,
          b: dc.instances.unittest.b,
          c: ic.instances['*'].c,
          d: ic.instances.unittest.d,
          x: [0, 1, 2, 3], // Full replace
          deeper: {
            y: [1],
            zero: 0,
            one: 1,
            two: 2,
            three: 3
          }
        });
      });
    });
    describe('replace', function () {
      it('should properly merge each instance with *', function () {
        dcin.instances.unittest._strategy = 'replace';
        result = jsonMerger(['defaults']);

        expect(result.instances.unittest).to.deep.equal({
          b: dc.instances.unittest.b,
          c: dc.instances.unittest.c,
          d: dc.instances.unittest.d,
          x: [1],
          deeper: {
            one: 1
          }
        });
      });
      it('should properly merge the * instances', function () {
        dcin.instances.tmptest = {};
        icin.instances['*']._strategy = 'replace';
        result = jsonMerger(['defaults', 'instances']);

        expect(result.instances.tmptest).to.deep.equal({
          c: ic.instances['*'].c,
          d: ic.instances['*'].d,
          x: [2],
          deeper: {
            two: 2
          }
        });
      });
      it('should merge project instances in correct order (1)', function () {
        dcin.instances.unittest._strategy = 'replace';
        result = jsonMerger(['defaults', 'instances']);

        expect(result.instances.unittest).to.deep.equal({
          b: dc.instances.unittest.b,
          c: ic.instances['*'].c,
          d: ic.instances.unittest.d,
          x: [1, 2, 3], // 0 was replaced by 1, the rest was properly merged
          deeper: {
            one: 1,
            two: 2,
            three: 3
          }
        });
      });
      it('should merge project instances in correct order (2)', function () {
        icin.instances.unittest._strategy = 'replace';
        result = jsonMerger(['defaults', 'instances']);

        expect(result.instances.unittest).to.deep.equal({
          x: [3],
          d: 'instances unittest d',
          deeper: {
            three: 3
          }
        });
      });
      it('should properly merge objects from the highest level', function () {
        dcin.someObject = {
          foo: 'foo'
        };
        icin.someObject = {
          bar: 'bar'
        };
        icin._strategy = 'replace';
        // It's important we define the new `_instances` directive again since
        // the "old" one will never be read by the `replace` strategy.
        icin.instances._instances = true;
        result = jsonMerger(['defaults', 'instances']);

        expect(result.someObject).to.deep.equal({
          bar: 'bar'
        });
        expect(result.instances.unittest).to.deep.equal({
          c: ic.instances['*'].c,
          d: ic.instances.unittest.d,
          x: [2, 3],
          deeper: {
            two: 2,
            three: 3
          }
        });
      });
      it('should merge deeply nested project instances in correct order', function () {
        icin.instances.unittest.deeper._strategy = 'replace';
        result = jsonMerger(['defaults', 'instances']);

        expect(result.instances.unittest).to.deep.equal({
          a: dc.instances['*'].a,
          b: dc.instances.unittest.b,
          c: ic.instances['*'].c,
          d: ic.instances.unittest.d,
          x: [0, 1, 2, 3],
          deeper: {
            three: 3
          }
        });
      });
    });
    describe('delete', function () {
      it('should properly merge each instance with *', function () {
        dcin.instances.unittest._strategy = 'delete';
        result = jsonMerger(['defaults']);

        expect(result.instances.unittest).to.equal(null);
      });
      it('should properly merge the * instances', function () {
        dcin.instances.tmptest = {};
        icin.instances['*']._strategy = 'delete';
        result = jsonMerger(['defaults', 'instances']);

        expect(result.instances.tmptest).to.deep.equal(null);
      });
      it('should merge project instances in correct order (1)', function () {
        dcin.instances.unittest._strategy = 'delete';
        result = jsonMerger(['defaults', 'instances']);

        expect(result.instances.unittest).to.deep.equal({
          c: ic.instances['*'].c,
          d: ic.instances.unittest.d,
          x: [2, 3], // 0 and 1 were deleted, the rest was properly merged
          deeper: {
            two: 2,
            three: 3
          }
        });
      });
      it('should merge project instances in correct order (2)', function () {
        icin.instances.unittest._strategy = 'delete';
        result = jsonMerger(['defaults', 'instances']);

        expect(result.instances.unittest).to.equal(null);
      });
      it('should properly merge objects from the highest level', function () {
        icin._strategy = 'delete';
        result = jsonMerger(['defaults', 'instances']);

        expect(result).to.equal(null);
      });
      it('should merge deeply nested project instances in correct order', function () {
        icin.instances.unittest.deeper._strategy = 'delete';
        result = jsonMerger(['defaults', 'instances']);

        expect(result.instances.unittest).to.deep.equal({
          a: dc.instances['*'].a,
          b: dc.instances.unittest.b,
          c: ic.instances['*'].c,
          d: ic.instances.unittest.d,
          x: [0, 1, 2, 3], // 0 and 1 were deleted, the rest was properly merged
          deeper: null
        });
      });
    });
  });
});
