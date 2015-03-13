!function(e){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=e();else if("function"==typeof define&&define.amd)define([],e);else{var f;"undefined"!=typeof window?f=window:"undefined"!=typeof global?f=global:"undefined"!=typeof self&&(f=self),f.EPEG=e()}}(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
/*
  JavaScript implementation of a Packrat Parsers with left Recursion Support
  http://www.vpri.org/pdf/tr2007002_packrat.pdf

  No Indirect Left Recursion yet :-(

  Batiste Bieler 2014
*/
"use strict";

function tokenize(input, gram) {
  var keys = gram.tokenKeys;
  var tokens = gram.tokenMap;
  var stream = [];
  var len = input.length, candidate, i, key, copy = input, lastToken = null;
  var pointer = 0;

  while(pointer < len) {
    candidate = null;
    for(i=0; i<keys.length; i++) {
      key = keys[i];
      var token = tokens[key], match;
      if(token.func) {
        match = token.func(input, stream);
        if(match !== undefined) {
          candidate = match;
          break;
        }
      } else if(token.reg){
        match = input.match(token.reg);
        if(match !== null) {
          candidate = match[0];
          break;
        }
      } else {
        throw new Error("Tokenizer error: Invalid token " + key + " without a reg or func property");
      }
    }
    if(candidate !== null) {
      lastToken = {type:key, value:candidate, pointer:pointer};
      stream.push(lastToken);
      pointer += candidate.length;
      input = input.substr(candidate.length);
    } else {
      if(stream.length === 0) {
        throw new Error("Tokenizer error: total match failure");
      }
      if(lastToken)
        lastToken.pointer += lastToken.value.length;
      var msg = errorMsg(copy, stream[stream.length - 1], "Tokenizer error", "No matching token found");
      if(lastToken)
        msg += "\n" + "Before token of type " + lastToken.type + ": " + lastToken.value;
      throw new Error(msg);
    }
  }
  stream.push({type:'EOF', value:""});
  return stream;
}

function copyToken(stoken, rtoken) {
  var t = {
    type:stoken.type,
    value:stoken.value,
    repeat:rtoken.repeat
  };
  if(rtoken.name) {
    t.name = rtoken.name;
  }
  return t;
}

function createParams(tokens) {
  var params = {};
  var j = 0;
  tokens.map(function(i) {
    if(i.name) {
      if(i.repeat == '*' || i.repeat == '+') {
        if(!params[i.name]) {
          params[i.name] = [];
        }
        params[i.name].push(i);
      } else {
        params[i.name] = i;
      }
    }
    params['$'+j] = i;
    j++;
  });
  return params;
}

function growLR(grammar, rule, stream, pos, memo) {
  var sp, result, progress = false;
  var hook = grammar[rule.key].hooks[rule.index];

  while(true) {
    sp = pos;

    result = evalRuleBody(grammar, rule, stream, sp);

    // ensure some progress is made
    if(result === false || result.sp <= memo.sp) {
      return progress;
    }

    result.hook = hook;

    // it's very important to update the memoized value
    // this is actually growing the seed in the memoization
    memo.children = result.children;
    memo.sp = result.sp;
    memo.start = result.start;
    memo.hooked = result.hooked;
    memo.hook = result.hook;
    progress = result;
  }
  return progress;
}

function memoEval(grammar, rule, stream, pointer) {

  var key = rule.key+';'+pointer+';'+rule.index;

  // avoid infinite recursion
  // This is faster than filter
  var i = stack.length - 1;
  while(i >= 0) {
    if(stack[i][0] == key) {
      return false;
    }
    i = i-1;
  }

  var memo_entry = memoization[rule.key+';'+pointer];
  if(memo_entry !== undefined) {
    return memo_entry;
  }

  stack.push([key, rule]);
  var result = evalRuleBody(grammar, rule, stream, pointer);
  stack.pop();

  return result;
}

function canFail(token, node) {
  if(token.repeat === '*' || token.repeat === '?') {
    return true;
  }
  if(token.repeat === '+' && node.children.length && node.children[node.children.length - 1].type == token.type) {
    return true;
  }
  return false;
}

function canRepeat(token) {
  return token.repeat === '*' || token.repeat === '+';
}

function evalRuleBody(grammar, rule, stream, pointer) {

  var sp = pointer; // stream pointer
  var rp = 0;       // rule pointer
  var j, result;
  var currentNode = {type: rule.key, children:[], start:pointer, name:rule.name};

  var rtoken = rule.tokens[rp];
  var stoken = stream[sp];

  while(rtoken && stoken) {

    // Case one: we have a rule we need to develop
    if(grammar[rtoken.type]) {

      var expand_rules = grammar[rtoken.type].rules;
      var hooks = grammar[rtoken.type].hooks;
      result = false;

      var m = memoization[rtoken.type+';'+sp];
      if(m) {
        result = m;
      }

      if(!result) {
        for(j=0; j<expand_rules.length; j++) {
          var r = expand_rules[j], hook = hooks[j];

          result = memoEval(grammar, r, stream, sp);

          if(result) {

            result.hook = hook;

            memoization[r.key+';'+sp] = result;

            if(rtoken.repeat === false) {
              var n_result = growLR(grammar, rule, stream, sp, result);
              if(n_result !== false) {
                return n_result;
              }
            }
            break;
          }
        }
      }

      if(result) {
        sp = result.sp;
        currentNode.children.push({
            type: rtoken.type,
            children: result.children,
            sp:result.sp,
            hook: result.hook,
            name: rtoken.name,
            repeat: rtoken.repeat
          });
        if(!canRepeat(rtoken)) {
          rp++;
        }
      } else {
        if(!canFail(rtoken, currentNode)) {
          return false;
        }
        rp++;
      }

    // Case two: we have a proper token
    } else {
      if(stoken.type === rtoken.type) {
        //currentNode.children.push(copyToken(stoken, rtoken));
        if(!rtoken.nonCapturing) {
          currentNode.children.push(copyToken(stoken, rtoken));
          sp++;
        }
        if(!canRepeat(rtoken)) {
          rp++;
        }
      } else {
        if(!canFail(rtoken, currentNode)) {
          return false;
        }
        rp++;
      }

    }

    // information used for debugging purpose
    if(best_p === sp) {
      best_parse.candidates.push([rule, rule.tokens[rp]]);
    }
    if(best_p < sp) {
      best_parse = {sp:sp, candidates:[[rule, rule.tokens[rp]]]};
      best_p = sp;
    }

    // fetch next rule and stream token
    rtoken = rule.tokens[rp];
    stoken = stream[sp];

    // rule satisfied
    if(rtoken === undefined) {
      currentNode.sp = sp;
      currentNode.rp = rp;
      return currentNode;
    }

    // no more tokens
    if(stoken === undefined) {
      if(canFail(rtoken, currentNode)) {
        // This does not happen often because of EOF,
        // As it stands the last token as always to be EOF
        currentNode.sp = sp;
        currentNode.rp = rp;
        return currentNode;
      }
      return false;
    }

  } // end rule body loop

  return false;
}

function splitTrim(l, split) {
  return l.split(split).map(function(i){ return i.trim(); });
}

function grammarToken(token) {
  var nonCapturing = token.charAt(0) === '!';
  if(nonCapturing) {
    token = token.substr(1);
  }
  var repeat = token.charAt(token.length - 1);
  if(repeat === '*' || repeat === '?' || repeat === '+') {
    token = token.substr(0, token.length - 1);
  } else {
    repeat = false;
  }
  var named = token.split(":"), t;
  if(named.length === 2) {
    t = {
      'type': named[1],
      'name' :named[0]
    };
  } else {
    t = {'type': token };
  }
  t.repeat = repeat;
  if((repeat === '*' || repeat === '+') && nonCapturing) {
    throw new Error("Impossible to have non capturing token that repeats");
  }
  if(nonCapturing) {
    t.nonCapturing = nonCapturing;
  }
  return t;
}

function compileGrammar(grammar, tokenDef) {
  var keys = Object.keys(grammar), i, j, k;
  var gram = {}, optional, nonCapturing;

  gram.tokenDef = tokenDef;
  gram.tokenKeys = [];
  gram.tokenMap = {};
  tokenDef.map(function(t) {
    gram.tokenMap[t.key] = t;
    gram.tokenKeys.push(t.key);
  });

  var allValidKeys = keys.concat(gram.tokenKeys);

  for(i=0; i<keys.length; i++) {
    var line = grammar[keys[i]];
    var key = keys[i];
    var rules = line.rules;
    var hooks = [];

    var splitted_rules = [];

    for(j=0; j<rules.length; j++) {
      var tokens = splitTrim(rules[j], ' ');
      optional = 0;
      for(k=0; k<tokens.length; k++) {
        var token = tokens[k] = grammarToken(tokens[k]);
        if(allValidKeys.indexOf(token.type) === -1 && token.type !== 'EOF') {
          throw new Error("Invalid token type used in the grammar rule "+key+": " + token.type + ', valid tokens are: '+allValidKeys.join(', '));
        }
        if(token.repeat === '*') {
          optional += 1;
        }
        if(token.nonCapturing) {
          if(tokens[tokens.length - 1] != tokens[k]) {
            throw new Error("A non capturing token can only be the last one in the rule: " + token.type);
          }
        }
      }
      if(optional === tokens.length) {
        throw new Error("Rule " + rules[j] + " only has optional greedy tokens.");
      }
      splitted_rules.push({key: key, index:j, tokens:tokens});
      if(typeof line.hooks === "function") {
        hooks.push(line.hooks);
      } else if(line.hooks) {
        if(line.hooks[j] === undefined) {
          throw new Error("Incorrect number of hooks ar rule " + keys[i]); 
        }
        hooks.push(line.hooks[j]);
      }
    }
    gram[key] = {rules: splitted_rules, hooks: hooks || [], verbose:line.verbose};
  }
  gram.parse = function(stream) {
    return parse(stream, gram);
  };
  return gram;
}

function spacer(n) {
  var out = "";
  for(var i=0; i<n; i++) {
    out += " ";
  }
  return out;
}

function errorMsg(input, token, errorType, m) {

  var charn = token.pointer || 0;
  var lines = input.split("\n"), i, charCounter = 0, charOnLine = 0;

  for(i=0; i<lines.length; i++) {
    charCounter += lines[i].length + 1;
    if(charCounter >= charn) {
      break;
    }
    charOnLine += lines[i].length + 1;
  }

  var ln = Math.max(0, i); // line number
  var msg = errorType + " at line "+(ln+1)+" char "+ (charn - charOnLine) +": ";
  var indicator = "\n" + spacer((charn - charOnLine) + ((ln) + ': ').length);

  if(lines[ln-1] !== undefined) {
    msg = msg + "\n" + (ln) + ': ' + lines[ln-1];
  }
  msg = msg + "\n" + (ln+1) + ': ' + lines[ln] + indicator;
  msg = msg + "^-- " + m;

  if(lines[ln+1] !== undefined) {
    msg = msg + "\n" + (ln+2) + ': ' + lines[ln+1];
  }

  return msg;
}

function verboseName(grammar, type) {
  var tokendef = grammar.tokenMap[type];
  if(tokendef && tokendef.verbose) {
    return tokendef.verbose;
  }
  if(grammar[type] && grammar[type].verbose) {
    return grammar[type].verbose;
  }
  return type;
}

function hint(input, stream, best_parse, grammar) {
  if(!best_parse || !best_parse.candidates[0]) {
    return "Complete failure to parse";
  }
  var rule = best_parse.candidates[0][0];

  var array = [];
  best_parse.candidates.map(function(r) {
    if(!r[1]) { return; }
    var name = verboseName(grammar, r[1].type);
    if(array.indexOf(name) === -1) {
      array.push(name);
    }
  });
  var candidates = array.join(' or ');

  var msg = errorMsg(input, stream[best_parse.sp], "Parser error", "Rule " + verboseName(grammar, rule.key));
  msg = msg + "\nExpect " + candidates;
  var lastToken = stream[best_parse.sp] || {type:"EOF"};
  msg = msg + "\nBut got " + verboseName(grammar, lastToken.type) + " instead";

  return msg;
}

// those are module globals
var stack = [];
var memoization = {};
var best_parse = null;
var best_p = 0;

function hookTree(node) {
  if(!node.children) {
    return;
  }
  if(node.hook) {
    node.children = node.hook(createParams(node.children));
  }
  for(var i=0; i<node.children.length; i++) {
    hookTree(node.children[i]);
  }
}

function parse(input, grammar) {
  var bestResult = {type:'START', sp:0, complete:false}, i, result, stream;
  //if(typeof input === 'string') {
  stream = tokenize(input, grammar);
  //}
  best_parse = {sp:0, candidates:[]};
  best_p = 0;
  for(i=0; i<grammar.START.rules.length; i++) {
    stack = [];
    memoization = {};
    result = memoEval(grammar, grammar.START.rules[i], stream, 0);
    if(result && result.sp > bestResult.sp) {
      bestResult = {
        type:'START',
        children:result.children,
        sp: result.sp,
        complete:result.sp === stream.length,
        inputLength:stream.length,
      };
    }
  }
  bestResult.bestParse = best_parse;
  hookTree(bestResult);
  if(best_parse && !bestResult.complete) {
    bestResult.hint = hint(input, stream, best_parse, grammar);
  }
  return bestResult;
}

module.exports = {
  parse: parse,
  stack: stack,
  compileGrammar: compileGrammar,
  tokenize: tokenize,
  memoization: memoization
};

},{}]},{},[1])(1)
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJFUEVHLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiLypcbiAgSmF2YVNjcmlwdCBpbXBsZW1lbnRhdGlvbiBvZiBhIFBhY2tyYXQgUGFyc2VycyB3aXRoIGxlZnQgUmVjdXJzaW9uIFN1cHBvcnRcbiAgaHR0cDovL3d3dy52cHJpLm9yZy9wZGYvdHIyMDA3MDAyX3BhY2tyYXQucGRmXG5cbiAgTm8gSW5kaXJlY3QgTGVmdCBSZWN1cnNpb24geWV0IDotKFxuXG4gIEJhdGlzdGUgQmllbGVyIDIwMTRcbiovXG5cInVzZSBzdHJpY3RcIjtcblxuZnVuY3Rpb24gdG9rZW5pemUoaW5wdXQsIGdyYW0pIHtcbiAgdmFyIGtleXMgPSBncmFtLnRva2VuS2V5cztcbiAgdmFyIHRva2VucyA9IGdyYW0udG9rZW5NYXA7XG4gIHZhciBzdHJlYW0gPSBbXTtcbiAgdmFyIGxlbiA9IGlucHV0Lmxlbmd0aCwgY2FuZGlkYXRlLCBpLCBrZXksIGNvcHkgPSBpbnB1dCwgbGFzdFRva2VuID0gbnVsbDtcbiAgdmFyIHBvaW50ZXIgPSAwO1xuXG4gIHdoaWxlKHBvaW50ZXIgPCBsZW4pIHtcbiAgICBjYW5kaWRhdGUgPSBudWxsO1xuICAgIGZvcihpPTA7IGk8a2V5cy5sZW5ndGg7IGkrKykge1xuICAgICAga2V5ID0ga2V5c1tpXTtcbiAgICAgIHZhciB0b2tlbiA9IHRva2Vuc1trZXldLCBtYXRjaDtcbiAgICAgIGlmKHRva2VuLmZ1bmMpIHtcbiAgICAgICAgbWF0Y2ggPSB0b2tlbi5mdW5jKGlucHV0LCBzdHJlYW0pO1xuICAgICAgICBpZihtYXRjaCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgY2FuZGlkYXRlID0gbWF0Y2g7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZih0b2tlbi5yZWcpe1xuICAgICAgICBtYXRjaCA9IGlucHV0Lm1hdGNoKHRva2VuLnJlZyk7XG4gICAgICAgIGlmKG1hdGNoICE9PSBudWxsKSB7XG4gICAgICAgICAgY2FuZGlkYXRlID0gbWF0Y2hbMF07XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIlRva2VuaXplciBlcnJvcjogSW52YWxpZCB0b2tlbiBcIiArIGtleSArIFwiIHdpdGhvdXQgYSByZWcgb3IgZnVuYyBwcm9wZXJ0eVwiKTtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYoY2FuZGlkYXRlICE9PSBudWxsKSB7XG4gICAgICBsYXN0VG9rZW4gPSB7dHlwZTprZXksIHZhbHVlOmNhbmRpZGF0ZSwgcG9pbnRlcjpwb2ludGVyfTtcbiAgICAgIHN0cmVhbS5wdXNoKGxhc3RUb2tlbik7XG4gICAgICBwb2ludGVyICs9IGNhbmRpZGF0ZS5sZW5ndGg7XG4gICAgICBpbnB1dCA9IGlucHV0LnN1YnN0cihjYW5kaWRhdGUubGVuZ3RoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgaWYoc3RyZWFtLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJUb2tlbml6ZXIgZXJyb3I6IHRvdGFsIG1hdGNoIGZhaWx1cmVcIik7XG4gICAgICB9XG4gICAgICBpZihsYXN0VG9rZW4pXG4gICAgICAgIGxhc3RUb2tlbi5wb2ludGVyICs9IGxhc3RUb2tlbi52YWx1ZS5sZW5ndGg7XG4gICAgICB2YXIgbXNnID0gZXJyb3JNc2coY29weSwgc3RyZWFtW3N0cmVhbS5sZW5ndGggLSAxXSwgXCJUb2tlbml6ZXIgZXJyb3JcIiwgXCJObyBtYXRjaGluZyB0b2tlbiBmb3VuZFwiKTtcbiAgICAgIGlmKGxhc3RUb2tlbilcbiAgICAgICAgbXNnICs9IFwiXFxuXCIgKyBcIkJlZm9yZSB0b2tlbiBvZiB0eXBlIFwiICsgbGFzdFRva2VuLnR5cGUgKyBcIjogXCIgKyBsYXN0VG9rZW4udmFsdWU7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IobXNnKTtcbiAgICB9XG4gIH1cbiAgc3RyZWFtLnB1c2goe3R5cGU6J0VPRicsIHZhbHVlOlwiXCJ9KTtcbiAgcmV0dXJuIHN0cmVhbTtcbn1cblxuZnVuY3Rpb24gY29weVRva2VuKHN0b2tlbiwgcnRva2VuKSB7XG4gIHZhciB0ID0ge1xuICAgIHR5cGU6c3Rva2VuLnR5cGUsXG4gICAgdmFsdWU6c3Rva2VuLnZhbHVlLFxuICAgIHJlcGVhdDpydG9rZW4ucmVwZWF0XG4gIH07XG4gIGlmKHJ0b2tlbi5uYW1lKSB7XG4gICAgdC5uYW1lID0gcnRva2VuLm5hbWU7XG4gIH1cbiAgcmV0dXJuIHQ7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZVBhcmFtcyh0b2tlbnMpIHtcbiAgdmFyIHBhcmFtcyA9IHt9O1xuICB2YXIgaiA9IDA7XG4gIHRva2Vucy5tYXAoZnVuY3Rpb24oaSkge1xuICAgIGlmKGkubmFtZSkge1xuICAgICAgaWYoaS5yZXBlYXQgPT0gJyonIHx8IGkucmVwZWF0ID09ICcrJykge1xuICAgICAgICBpZighcGFyYW1zW2kubmFtZV0pIHtcbiAgICAgICAgICBwYXJhbXNbaS5uYW1lXSA9IFtdO1xuICAgICAgICB9XG4gICAgICAgIHBhcmFtc1tpLm5hbWVdLnB1c2goaSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBwYXJhbXNbaS5uYW1lXSA9IGk7XG4gICAgICB9XG4gICAgfVxuICAgIHBhcmFtc1snJCcral0gPSBpO1xuICAgIGorKztcbiAgfSk7XG4gIHJldHVybiBwYXJhbXM7XG59XG5cbmZ1bmN0aW9uIGdyb3dMUihncmFtbWFyLCBydWxlLCBzdHJlYW0sIHBvcywgbWVtbykge1xuICB2YXIgc3AsIHJlc3VsdCwgcHJvZ3Jlc3MgPSBmYWxzZTtcbiAgdmFyIGhvb2sgPSBncmFtbWFyW3J1bGUua2V5XS5ob29rc1tydWxlLmluZGV4XTtcblxuICB3aGlsZSh0cnVlKSB7XG4gICAgc3AgPSBwb3M7XG5cbiAgICByZXN1bHQgPSBldmFsUnVsZUJvZHkoZ3JhbW1hciwgcnVsZSwgc3RyZWFtLCBzcCk7XG5cbiAgICAvLyBlbnN1cmUgc29tZSBwcm9ncmVzcyBpcyBtYWRlXG4gICAgaWYocmVzdWx0ID09PSBmYWxzZSB8fCByZXN1bHQuc3AgPD0gbWVtby5zcCkge1xuICAgICAgcmV0dXJuIHByb2dyZXNzO1xuICAgIH1cblxuICAgIHJlc3VsdC5ob29rID0gaG9vaztcblxuICAgIC8vIGl0J3MgdmVyeSBpbXBvcnRhbnQgdG8gdXBkYXRlIHRoZSBtZW1vaXplZCB2YWx1ZVxuICAgIC8vIHRoaXMgaXMgYWN0dWFsbHkgZ3Jvd2luZyB0aGUgc2VlZCBpbiB0aGUgbWVtb2l6YXRpb25cbiAgICBtZW1vLmNoaWxkcmVuID0gcmVzdWx0LmNoaWxkcmVuO1xuICAgIG1lbW8uc3AgPSByZXN1bHQuc3A7XG4gICAgbWVtby5zdGFydCA9IHJlc3VsdC5zdGFydDtcbiAgICBtZW1vLmhvb2tlZCA9IHJlc3VsdC5ob29rZWQ7XG4gICAgbWVtby5ob29rID0gcmVzdWx0Lmhvb2s7XG4gICAgcHJvZ3Jlc3MgPSByZXN1bHQ7XG4gIH1cbiAgcmV0dXJuIHByb2dyZXNzO1xufVxuXG5mdW5jdGlvbiBtZW1vRXZhbChncmFtbWFyLCBydWxlLCBzdHJlYW0sIHBvaW50ZXIpIHtcblxuICB2YXIga2V5ID0gcnVsZS5rZXkrJzsnK3BvaW50ZXIrJzsnK3J1bGUuaW5kZXg7XG5cbiAgLy8gYXZvaWQgaW5maW5pdGUgcmVjdXJzaW9uXG4gIC8vIFRoaXMgaXMgZmFzdGVyIHRoYW4gZmlsdGVyXG4gIHZhciBpID0gc3RhY2subGVuZ3RoIC0gMTtcbiAgd2hpbGUoaSA+PSAwKSB7XG4gICAgaWYoc3RhY2tbaV1bMF0gPT0ga2V5KSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGkgPSBpLTE7XG4gIH1cblxuICB2YXIgbWVtb19lbnRyeSA9IG1lbW9pemF0aW9uW3J1bGUua2V5Kyc7Jytwb2ludGVyXTtcbiAgaWYobWVtb19lbnRyeSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgcmV0dXJuIG1lbW9fZW50cnk7XG4gIH1cblxuICBzdGFjay5wdXNoKFtrZXksIHJ1bGVdKTtcbiAgdmFyIHJlc3VsdCA9IGV2YWxSdWxlQm9keShncmFtbWFyLCBydWxlLCBzdHJlYW0sIHBvaW50ZXIpO1xuICBzdGFjay5wb3AoKTtcblxuICByZXR1cm4gcmVzdWx0O1xufVxuXG5mdW5jdGlvbiBjYW5GYWlsKHRva2VuLCBub2RlKSB7XG4gIGlmKHRva2VuLnJlcGVhdCA9PT0gJyonIHx8IHRva2VuLnJlcGVhdCA9PT0gJz8nKSB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cbiAgaWYodG9rZW4ucmVwZWF0ID09PSAnKycgJiYgbm9kZS5jaGlsZHJlbi5sZW5ndGggJiYgbm9kZS5jaGlsZHJlbltub2RlLmNoaWxkcmVuLmxlbmd0aCAtIDFdLnR5cGUgPT0gdG9rZW4udHlwZSkge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuZnVuY3Rpb24gY2FuUmVwZWF0KHRva2VuKSB7XG4gIHJldHVybiB0b2tlbi5yZXBlYXQgPT09ICcqJyB8fCB0b2tlbi5yZXBlYXQgPT09ICcrJztcbn1cblxuZnVuY3Rpb24gZXZhbFJ1bGVCb2R5KGdyYW1tYXIsIHJ1bGUsIHN0cmVhbSwgcG9pbnRlcikge1xuXG4gIHZhciBzcCA9IHBvaW50ZXI7IC8vIHN0cmVhbSBwb2ludGVyXG4gIHZhciBycCA9IDA7ICAgICAgIC8vIHJ1bGUgcG9pbnRlclxuICB2YXIgaiwgcmVzdWx0O1xuICB2YXIgY3VycmVudE5vZGUgPSB7dHlwZTogcnVsZS5rZXksIGNoaWxkcmVuOltdLCBzdGFydDpwb2ludGVyLCBuYW1lOnJ1bGUubmFtZX07XG5cbiAgdmFyIHJ0b2tlbiA9IHJ1bGUudG9rZW5zW3JwXTtcbiAgdmFyIHN0b2tlbiA9IHN0cmVhbVtzcF07XG5cbiAgd2hpbGUocnRva2VuICYmIHN0b2tlbikge1xuXG4gICAgLy8gQ2FzZSBvbmU6IHdlIGhhdmUgYSBydWxlIHdlIG5lZWQgdG8gZGV2ZWxvcFxuICAgIGlmKGdyYW1tYXJbcnRva2VuLnR5cGVdKSB7XG5cbiAgICAgIHZhciBleHBhbmRfcnVsZXMgPSBncmFtbWFyW3J0b2tlbi50eXBlXS5ydWxlcztcbiAgICAgIHZhciBob29rcyA9IGdyYW1tYXJbcnRva2VuLnR5cGVdLmhvb2tzO1xuICAgICAgcmVzdWx0ID0gZmFsc2U7XG5cbiAgICAgIHZhciBtID0gbWVtb2l6YXRpb25bcnRva2VuLnR5cGUrJzsnK3NwXTtcbiAgICAgIGlmKG0pIHtcbiAgICAgICAgcmVzdWx0ID0gbTtcbiAgICAgIH1cblxuICAgICAgaWYoIXJlc3VsdCkge1xuICAgICAgICBmb3Ioaj0wOyBqPGV4cGFuZF9ydWxlcy5sZW5ndGg7IGorKykge1xuICAgICAgICAgIHZhciByID0gZXhwYW5kX3J1bGVzW2pdLCBob29rID0gaG9va3Nbal07XG5cbiAgICAgICAgICByZXN1bHQgPSBtZW1vRXZhbChncmFtbWFyLCByLCBzdHJlYW0sIHNwKTtcblxuICAgICAgICAgIGlmKHJlc3VsdCkge1xuXG4gICAgICAgICAgICByZXN1bHQuaG9vayA9IGhvb2s7XG5cbiAgICAgICAgICAgIG1lbW9pemF0aW9uW3Iua2V5Kyc7JytzcF0gPSByZXN1bHQ7XG5cbiAgICAgICAgICAgIGlmKHJ0b2tlbi5yZXBlYXQgPT09IGZhbHNlKSB7XG4gICAgICAgICAgICAgIHZhciBuX3Jlc3VsdCA9IGdyb3dMUihncmFtbWFyLCBydWxlLCBzdHJlYW0sIHNwLCByZXN1bHQpO1xuICAgICAgICAgICAgICBpZihuX3Jlc3VsdCAhPT0gZmFsc2UpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gbl9yZXN1bHQ7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZihyZXN1bHQpIHtcbiAgICAgICAgc3AgPSByZXN1bHQuc3A7XG4gICAgICAgIGN1cnJlbnROb2RlLmNoaWxkcmVuLnB1c2goe1xuICAgICAgICAgICAgdHlwZTogcnRva2VuLnR5cGUsXG4gICAgICAgICAgICBjaGlsZHJlbjogcmVzdWx0LmNoaWxkcmVuLFxuICAgICAgICAgICAgc3A6cmVzdWx0LnNwLFxuICAgICAgICAgICAgaG9vazogcmVzdWx0Lmhvb2ssXG4gICAgICAgICAgICBuYW1lOiBydG9rZW4ubmFtZSxcbiAgICAgICAgICAgIHJlcGVhdDogcnRva2VuLnJlcGVhdFxuICAgICAgICAgIH0pO1xuICAgICAgICBpZighY2FuUmVwZWF0KHJ0b2tlbikpIHtcbiAgICAgICAgICBycCsrO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZighY2FuRmFpbChydG9rZW4sIGN1cnJlbnROb2RlKSkge1xuICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICBycCsrO1xuICAgICAgfVxuXG4gICAgLy8gQ2FzZSB0d286IHdlIGhhdmUgYSBwcm9wZXIgdG9rZW5cbiAgICB9IGVsc2Uge1xuICAgICAgaWYoc3Rva2VuLnR5cGUgPT09IHJ0b2tlbi50eXBlKSB7XG4gICAgICAgIC8vY3VycmVudE5vZGUuY2hpbGRyZW4ucHVzaChjb3B5VG9rZW4oc3Rva2VuLCBydG9rZW4pKTtcbiAgICAgICAgaWYoIXJ0b2tlbi5ub25DYXB0dXJpbmcpIHtcbiAgICAgICAgICBjdXJyZW50Tm9kZS5jaGlsZHJlbi5wdXNoKGNvcHlUb2tlbihzdG9rZW4sIHJ0b2tlbikpO1xuICAgICAgICAgIHNwKys7XG4gICAgICAgIH1cbiAgICAgICAgaWYoIWNhblJlcGVhdChydG9rZW4pKSB7XG4gICAgICAgICAgcnArKztcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYoIWNhbkZhaWwocnRva2VuLCBjdXJyZW50Tm9kZSkpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgcnArKztcbiAgICAgIH1cblxuICAgIH1cblxuICAgIC8vIGluZm9ybWF0aW9uIHVzZWQgZm9yIGRlYnVnZ2luZyBwdXJwb3NlXG4gICAgaWYoYmVzdF9wID09PSBzcCkge1xuICAgICAgYmVzdF9wYXJzZS5jYW5kaWRhdGVzLnB1c2goW3J1bGUsIHJ1bGUudG9rZW5zW3JwXV0pO1xuICAgIH1cbiAgICBpZihiZXN0X3AgPCBzcCkge1xuICAgICAgYmVzdF9wYXJzZSA9IHtzcDpzcCwgY2FuZGlkYXRlczpbW3J1bGUsIHJ1bGUudG9rZW5zW3JwXV1dfTtcbiAgICAgIGJlc3RfcCA9IHNwO1xuICAgIH1cblxuICAgIC8vIGZldGNoIG5leHQgcnVsZSBhbmQgc3RyZWFtIHRva2VuXG4gICAgcnRva2VuID0gcnVsZS50b2tlbnNbcnBdO1xuICAgIHN0b2tlbiA9IHN0cmVhbVtzcF07XG5cbiAgICAvLyBydWxlIHNhdGlzZmllZFxuICAgIGlmKHJ0b2tlbiA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBjdXJyZW50Tm9kZS5zcCA9IHNwO1xuICAgICAgY3VycmVudE5vZGUucnAgPSBycDtcbiAgICAgIHJldHVybiBjdXJyZW50Tm9kZTtcbiAgICB9XG5cbiAgICAvLyBubyBtb3JlIHRva2Vuc1xuICAgIGlmKHN0b2tlbiA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBpZihjYW5GYWlsKHJ0b2tlbiwgY3VycmVudE5vZGUpKSB7XG4gICAgICAgIC8vIFRoaXMgZG9lcyBub3QgaGFwcGVuIG9mdGVuIGJlY2F1c2Ugb2YgRU9GLFxuICAgICAgICAvLyBBcyBpdCBzdGFuZHMgdGhlIGxhc3QgdG9rZW4gYXMgYWx3YXlzIHRvIGJlIEVPRlxuICAgICAgICBjdXJyZW50Tm9kZS5zcCA9IHNwO1xuICAgICAgICBjdXJyZW50Tm9kZS5ycCA9IHJwO1xuICAgICAgICByZXR1cm4gY3VycmVudE5vZGU7XG4gICAgICB9XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gIH0gLy8gZW5kIHJ1bGUgYm9keSBsb29wXG5cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG5mdW5jdGlvbiBzcGxpdFRyaW0obCwgc3BsaXQpIHtcbiAgcmV0dXJuIGwuc3BsaXQoc3BsaXQpLm1hcChmdW5jdGlvbihpKXsgcmV0dXJuIGkudHJpbSgpOyB9KTtcbn1cblxuZnVuY3Rpb24gZ3JhbW1hclRva2VuKHRva2VuKSB7XG4gIHZhciBub25DYXB0dXJpbmcgPSB0b2tlbi5jaGFyQXQoMCkgPT09ICchJztcbiAgaWYobm9uQ2FwdHVyaW5nKSB7XG4gICAgdG9rZW4gPSB0b2tlbi5zdWJzdHIoMSk7XG4gIH1cbiAgdmFyIHJlcGVhdCA9IHRva2VuLmNoYXJBdCh0b2tlbi5sZW5ndGggLSAxKTtcbiAgaWYocmVwZWF0ID09PSAnKicgfHwgcmVwZWF0ID09PSAnPycgfHwgcmVwZWF0ID09PSAnKycpIHtcbiAgICB0b2tlbiA9IHRva2VuLnN1YnN0cigwLCB0b2tlbi5sZW5ndGggLSAxKTtcbiAgfSBlbHNlIHtcbiAgICByZXBlYXQgPSBmYWxzZTtcbiAgfVxuICB2YXIgbmFtZWQgPSB0b2tlbi5zcGxpdChcIjpcIiksIHQ7XG4gIGlmKG5hbWVkLmxlbmd0aCA9PT0gMikge1xuICAgIHQgPSB7XG4gICAgICAndHlwZSc6IG5hbWVkWzFdLFxuICAgICAgJ25hbWUnIDpuYW1lZFswXVxuICAgIH07XG4gIH0gZWxzZSB7XG4gICAgdCA9IHsndHlwZSc6IHRva2VuIH07XG4gIH1cbiAgdC5yZXBlYXQgPSByZXBlYXQ7XG4gIGlmKChyZXBlYXQgPT09ICcqJyB8fCByZXBlYXQgPT09ICcrJykgJiYgbm9uQ2FwdHVyaW5nKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiSW1wb3NzaWJsZSB0byBoYXZlIG5vbiBjYXB0dXJpbmcgdG9rZW4gdGhhdCByZXBlYXRzXCIpO1xuICB9XG4gIGlmKG5vbkNhcHR1cmluZykge1xuICAgIHQubm9uQ2FwdHVyaW5nID0gbm9uQ2FwdHVyaW5nO1xuICB9XG4gIHJldHVybiB0O1xufVxuXG5mdW5jdGlvbiBjb21waWxlR3JhbW1hcihncmFtbWFyLCB0b2tlbkRlZikge1xuICB2YXIga2V5cyA9IE9iamVjdC5rZXlzKGdyYW1tYXIpLCBpLCBqLCBrO1xuICB2YXIgZ3JhbSA9IHt9LCBvcHRpb25hbCwgbm9uQ2FwdHVyaW5nO1xuXG4gIGdyYW0udG9rZW5EZWYgPSB0b2tlbkRlZjtcbiAgZ3JhbS50b2tlbktleXMgPSBbXTtcbiAgZ3JhbS50b2tlbk1hcCA9IHt9O1xuICB0b2tlbkRlZi5tYXAoZnVuY3Rpb24odCkge1xuICAgIGdyYW0udG9rZW5NYXBbdC5rZXldID0gdDtcbiAgICBncmFtLnRva2VuS2V5cy5wdXNoKHQua2V5KTtcbiAgfSk7XG5cbiAgdmFyIGFsbFZhbGlkS2V5cyA9IGtleXMuY29uY2F0KGdyYW0udG9rZW5LZXlzKTtcblxuICBmb3IoaT0wOyBpPGtleXMubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgbGluZSA9IGdyYW1tYXJba2V5c1tpXV07XG4gICAgdmFyIGtleSA9IGtleXNbaV07XG4gICAgdmFyIHJ1bGVzID0gbGluZS5ydWxlcztcbiAgICB2YXIgaG9va3MgPSBbXTtcblxuICAgIHZhciBzcGxpdHRlZF9ydWxlcyA9IFtdO1xuXG4gICAgZm9yKGo9MDsgajxydWxlcy5sZW5ndGg7IGorKykge1xuICAgICAgdmFyIHRva2VucyA9IHNwbGl0VHJpbShydWxlc1tqXSwgJyAnKTtcbiAgICAgIG9wdGlvbmFsID0gMDtcbiAgICAgIGZvcihrPTA7IGs8dG9rZW5zLmxlbmd0aDsgaysrKSB7XG4gICAgICAgIHZhciB0b2tlbiA9IHRva2Vuc1trXSA9IGdyYW1tYXJUb2tlbih0b2tlbnNba10pO1xuICAgICAgICBpZihhbGxWYWxpZEtleXMuaW5kZXhPZih0b2tlbi50eXBlKSA9PT0gLTEgJiYgdG9rZW4udHlwZSAhPT0gJ0VPRicpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJJbnZhbGlkIHRva2VuIHR5cGUgdXNlZCBpbiB0aGUgZ3JhbW1hciBydWxlIFwiK2tleStcIjogXCIgKyB0b2tlbi50eXBlICsgJywgdmFsaWQgdG9rZW5zIGFyZTogJythbGxWYWxpZEtleXMuam9pbignLCAnKSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYodG9rZW4ucmVwZWF0ID09PSAnKicpIHtcbiAgICAgICAgICBvcHRpb25hbCArPSAxO1xuICAgICAgICB9XG4gICAgICAgIGlmKHRva2VuLm5vbkNhcHR1cmluZykge1xuICAgICAgICAgIGlmKHRva2Vuc1t0b2tlbnMubGVuZ3RoIC0gMV0gIT0gdG9rZW5zW2tdKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJBIG5vbiBjYXB0dXJpbmcgdG9rZW4gY2FuIG9ubHkgYmUgdGhlIGxhc3Qgb25lIGluIHRoZSBydWxlOiBcIiArIHRva2VuLnR5cGUpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYob3B0aW9uYWwgPT09IHRva2Vucy5sZW5ndGgpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUnVsZSBcIiArIHJ1bGVzW2pdICsgXCIgb25seSBoYXMgb3B0aW9uYWwgZ3JlZWR5IHRva2Vucy5cIik7XG4gICAgICB9XG4gICAgICBzcGxpdHRlZF9ydWxlcy5wdXNoKHtrZXk6IGtleSwgaW5kZXg6aiwgdG9rZW5zOnRva2Vuc30pO1xuICAgICAgaWYodHlwZW9mIGxpbmUuaG9va3MgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICBob29rcy5wdXNoKGxpbmUuaG9va3MpO1xuICAgICAgfSBlbHNlIGlmKGxpbmUuaG9va3MpIHtcbiAgICAgICAgaWYobGluZS5ob29rc1tqXSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiSW5jb3JyZWN0IG51bWJlciBvZiBob29rcyBhciBydWxlIFwiICsga2V5c1tpXSk7IFxuICAgICAgICB9XG4gICAgICAgIGhvb2tzLnB1c2gobGluZS5ob29rc1tqXSk7XG4gICAgICB9XG4gICAgfVxuICAgIGdyYW1ba2V5XSA9IHtydWxlczogc3BsaXR0ZWRfcnVsZXMsIGhvb2tzOiBob29rcyB8fCBbXSwgdmVyYm9zZTpsaW5lLnZlcmJvc2V9O1xuICB9XG4gIGdyYW0ucGFyc2UgPSBmdW5jdGlvbihzdHJlYW0pIHtcbiAgICByZXR1cm4gcGFyc2Uoc3RyZWFtLCBncmFtKTtcbiAgfTtcbiAgcmV0dXJuIGdyYW07XG59XG5cbmZ1bmN0aW9uIHNwYWNlcihuKSB7XG4gIHZhciBvdXQgPSBcIlwiO1xuICBmb3IodmFyIGk9MDsgaTxuOyBpKyspIHtcbiAgICBvdXQgKz0gXCIgXCI7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuZnVuY3Rpb24gZXJyb3JNc2coaW5wdXQsIHRva2VuLCBlcnJvclR5cGUsIG0pIHtcblxuICB2YXIgY2hhcm4gPSB0b2tlbi5wb2ludGVyIHx8IDA7XG4gIHZhciBsaW5lcyA9IGlucHV0LnNwbGl0KFwiXFxuXCIpLCBpLCBjaGFyQ291bnRlciA9IDAsIGNoYXJPbkxpbmUgPSAwO1xuXG4gIGZvcihpPTA7IGk8bGluZXMubGVuZ3RoOyBpKyspIHtcbiAgICBjaGFyQ291bnRlciArPSBsaW5lc1tpXS5sZW5ndGggKyAxO1xuICAgIGlmKGNoYXJDb3VudGVyID49IGNoYXJuKSB7XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgY2hhck9uTGluZSArPSBsaW5lc1tpXS5sZW5ndGggKyAxO1xuICB9XG5cbiAgdmFyIGxuID0gTWF0aC5tYXgoMCwgaSk7IC8vIGxpbmUgbnVtYmVyXG4gIHZhciBtc2cgPSBlcnJvclR5cGUgKyBcIiBhdCBsaW5lIFwiKyhsbisxKStcIiBjaGFyIFwiKyAoY2hhcm4gLSBjaGFyT25MaW5lKSArXCI6IFwiO1xuICB2YXIgaW5kaWNhdG9yID0gXCJcXG5cIiArIHNwYWNlcigoY2hhcm4gLSBjaGFyT25MaW5lKSArICgobG4pICsgJzogJykubGVuZ3RoKTtcblxuICBpZihsaW5lc1tsbi0xXSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgbXNnID0gbXNnICsgXCJcXG5cIiArIChsbikgKyAnOiAnICsgbGluZXNbbG4tMV07XG4gIH1cbiAgbXNnID0gbXNnICsgXCJcXG5cIiArIChsbisxKSArICc6ICcgKyBsaW5lc1tsbl0gKyBpbmRpY2F0b3I7XG4gIG1zZyA9IG1zZyArIFwiXi0tIFwiICsgbTtcblxuICBpZihsaW5lc1tsbisxXSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgbXNnID0gbXNnICsgXCJcXG5cIiArIChsbisyKSArICc6ICcgKyBsaW5lc1tsbisxXTtcbiAgfVxuXG4gIHJldHVybiBtc2c7XG59XG5cbmZ1bmN0aW9uIHZlcmJvc2VOYW1lKGdyYW1tYXIsIHR5cGUpIHtcbiAgdmFyIHRva2VuZGVmID0gZ3JhbW1hci50b2tlbk1hcFt0eXBlXTtcbiAgaWYodG9rZW5kZWYgJiYgdG9rZW5kZWYudmVyYm9zZSkge1xuICAgIHJldHVybiB0b2tlbmRlZi52ZXJib3NlO1xuICB9XG4gIGlmKGdyYW1tYXJbdHlwZV0gJiYgZ3JhbW1hclt0eXBlXS52ZXJib3NlKSB7XG4gICAgcmV0dXJuIGdyYW1tYXJbdHlwZV0udmVyYm9zZTtcbiAgfVxuICByZXR1cm4gdHlwZTtcbn1cblxuZnVuY3Rpb24gaGludChpbnB1dCwgc3RyZWFtLCBiZXN0X3BhcnNlLCBncmFtbWFyKSB7XG4gIGlmKCFiZXN0X3BhcnNlIHx8ICFiZXN0X3BhcnNlLmNhbmRpZGF0ZXNbMF0pIHtcbiAgICByZXR1cm4gXCJDb21wbGV0ZSBmYWlsdXJlIHRvIHBhcnNlXCI7XG4gIH1cbiAgdmFyIHJ1bGUgPSBiZXN0X3BhcnNlLmNhbmRpZGF0ZXNbMF1bMF07XG5cbiAgdmFyIGFycmF5ID0gW107XG4gIGJlc3RfcGFyc2UuY2FuZGlkYXRlcy5tYXAoZnVuY3Rpb24ocikge1xuICAgIGlmKCFyWzFdKSB7IHJldHVybjsgfVxuICAgIHZhciBuYW1lID0gdmVyYm9zZU5hbWUoZ3JhbW1hciwgclsxXS50eXBlKTtcbiAgICBpZihhcnJheS5pbmRleE9mKG5hbWUpID09PSAtMSkge1xuICAgICAgYXJyYXkucHVzaChuYW1lKTtcbiAgICB9XG4gIH0pO1xuICB2YXIgY2FuZGlkYXRlcyA9IGFycmF5LmpvaW4oJyBvciAnKTtcblxuICB2YXIgbXNnID0gZXJyb3JNc2coaW5wdXQsIHN0cmVhbVtiZXN0X3BhcnNlLnNwXSwgXCJQYXJzZXIgZXJyb3JcIiwgXCJSdWxlIFwiICsgdmVyYm9zZU5hbWUoZ3JhbW1hciwgcnVsZS5rZXkpKTtcbiAgbXNnID0gbXNnICsgXCJcXG5FeHBlY3QgXCIgKyBjYW5kaWRhdGVzO1xuICB2YXIgbGFzdFRva2VuID0gc3RyZWFtW2Jlc3RfcGFyc2Uuc3BdIHx8IHt0eXBlOlwiRU9GXCJ9O1xuICBtc2cgPSBtc2cgKyBcIlxcbkJ1dCBnb3QgXCIgKyB2ZXJib3NlTmFtZShncmFtbWFyLCBsYXN0VG9rZW4udHlwZSkgKyBcIiBpbnN0ZWFkXCI7XG5cbiAgcmV0dXJuIG1zZztcbn1cblxuLy8gdGhvc2UgYXJlIG1vZHVsZSBnbG9iYWxzXG52YXIgc3RhY2sgPSBbXTtcbnZhciBtZW1vaXphdGlvbiA9IHt9O1xudmFyIGJlc3RfcGFyc2UgPSBudWxsO1xudmFyIGJlc3RfcCA9IDA7XG5cbmZ1bmN0aW9uIGhvb2tUcmVlKG5vZGUpIHtcbiAgaWYoIW5vZGUuY2hpbGRyZW4pIHtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYobm9kZS5ob29rKSB7XG4gICAgbm9kZS5jaGlsZHJlbiA9IG5vZGUuaG9vayhjcmVhdGVQYXJhbXMobm9kZS5jaGlsZHJlbikpO1xuICB9XG4gIGZvcih2YXIgaT0wOyBpPG5vZGUuY2hpbGRyZW4ubGVuZ3RoOyBpKyspIHtcbiAgICBob29rVHJlZShub2RlLmNoaWxkcmVuW2ldKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBwYXJzZShpbnB1dCwgZ3JhbW1hcikge1xuICB2YXIgYmVzdFJlc3VsdCA9IHt0eXBlOidTVEFSVCcsIHNwOjAsIGNvbXBsZXRlOmZhbHNlfSwgaSwgcmVzdWx0LCBzdHJlYW07XG4gIC8vaWYodHlwZW9mIGlucHV0ID09PSAnc3RyaW5nJykge1xuICBzdHJlYW0gPSB0b2tlbml6ZShpbnB1dCwgZ3JhbW1hcik7XG4gIC8vfVxuICBiZXN0X3BhcnNlID0ge3NwOjAsIGNhbmRpZGF0ZXM6W119O1xuICBiZXN0X3AgPSAwO1xuICBmb3IoaT0wOyBpPGdyYW1tYXIuU1RBUlQucnVsZXMubGVuZ3RoOyBpKyspIHtcbiAgICBzdGFjayA9IFtdO1xuICAgIG1lbW9pemF0aW9uID0ge307XG4gICAgcmVzdWx0ID0gbWVtb0V2YWwoZ3JhbW1hciwgZ3JhbW1hci5TVEFSVC5ydWxlc1tpXSwgc3RyZWFtLCAwKTtcbiAgICBpZihyZXN1bHQgJiYgcmVzdWx0LnNwID4gYmVzdFJlc3VsdC5zcCkge1xuICAgICAgYmVzdFJlc3VsdCA9IHtcbiAgICAgICAgdHlwZTonU1RBUlQnLFxuICAgICAgICBjaGlsZHJlbjpyZXN1bHQuY2hpbGRyZW4sXG4gICAgICAgIHNwOiByZXN1bHQuc3AsXG4gICAgICAgIGNvbXBsZXRlOnJlc3VsdC5zcCA9PT0gc3RyZWFtLmxlbmd0aCxcbiAgICAgICAgaW5wdXRMZW5ndGg6c3RyZWFtLmxlbmd0aCxcbiAgICAgIH07XG4gICAgfVxuICB9XG4gIGJlc3RSZXN1bHQuYmVzdFBhcnNlID0gYmVzdF9wYXJzZTtcbiAgaG9va1RyZWUoYmVzdFJlc3VsdCk7XG4gIGlmKGJlc3RfcGFyc2UgJiYgIWJlc3RSZXN1bHQuY29tcGxldGUpIHtcbiAgICBiZXN0UmVzdWx0LmhpbnQgPSBoaW50KGlucHV0LCBzdHJlYW0sIGJlc3RfcGFyc2UsIGdyYW1tYXIpO1xuICB9XG4gIHJldHVybiBiZXN0UmVzdWx0O1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgcGFyc2U6IHBhcnNlLFxuICBzdGFjazogc3RhY2ssXG4gIGNvbXBpbGVHcmFtbWFyOiBjb21waWxlR3JhbW1hcixcbiAgdG9rZW5pemU6IHRva2VuaXplLFxuICBtZW1vaXphdGlvbjogbWVtb2l6YXRpb25cbn07XG4iXX0=
