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
        match = token.func(input);
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

    // apply rule hooks
    if(hook && !result.hooked) {
      result.children = hook(createParams(result.children));
      result.hooked = true;
    }
    result.hooked = true;

    // it's very important to update the memoized value
    // this is actually growing the seed in the memoization
    memo.children = result.children;
    memo.sp = result.sp;
    memo.start = result.start;
    memo.hooked = result.hooked;
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
          var r = expand_rules[j];
          var hook = hooks && hooks[j];

          result = memoEval(grammar, r, stream, sp);

          if(result) {

            if(hook && !result.hooked) {
              result.children = hook(createParams(result.children));
            }
            result.hooked = true;

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
            children:result.children,
            sp:result.sp,
            name:rtoken.name,
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
    }
    // todo: use a property
    gram[key] = {rules: splitted_rules, hooks: line.hooks || [], verbose:line.verbose};
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJFUEVHLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIvKlxuICBKYXZhU2NyaXB0IGltcGxlbWVudGF0aW9uIG9mIGEgUGFja3JhdCBQYXJzZXJzIHdpdGggbGVmdCBSZWN1cnNpb24gU3VwcG9ydFxuICBodHRwOi8vd3d3LnZwcmkub3JnL3BkZi90cjIwMDcwMDJfcGFja3JhdC5wZGZcblxuICBObyBJbmRpcmVjdCBMZWZ0IFJlY3Vyc2lvbiB5ZXQgOi0oXG5cbiAgQmF0aXN0ZSBCaWVsZXIgMjAxNFxuKi9cblwidXNlIHN0cmljdFwiO1xuXG5mdW5jdGlvbiB0b2tlbml6ZShpbnB1dCwgZ3JhbSkge1xuICB2YXIga2V5cyA9IGdyYW0udG9rZW5LZXlzO1xuICB2YXIgdG9rZW5zID0gZ3JhbS50b2tlbk1hcDtcbiAgdmFyIHN0cmVhbSA9IFtdO1xuICB2YXIgbGVuID0gaW5wdXQubGVuZ3RoLCBjYW5kaWRhdGUsIGksIGtleSwgY29weSA9IGlucHV0LCBsYXN0VG9rZW4gPSBudWxsO1xuICB2YXIgcG9pbnRlciA9IDA7XG5cbiAgd2hpbGUocG9pbnRlciA8IGxlbikge1xuICAgIGNhbmRpZGF0ZSA9IG51bGw7XG4gICAgZm9yKGk9MDsgaTxrZXlzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBrZXkgPSBrZXlzW2ldO1xuICAgICAgdmFyIHRva2VuID0gdG9rZW5zW2tleV0sIG1hdGNoO1xuICAgICAgaWYodG9rZW4uZnVuYykge1xuICAgICAgICBtYXRjaCA9IHRva2VuLmZ1bmMoaW5wdXQpO1xuICAgICAgICBpZihtYXRjaCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgY2FuZGlkYXRlID0gbWF0Y2g7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZih0b2tlbi5yZWcpe1xuICAgICAgICBtYXRjaCA9IGlucHV0Lm1hdGNoKHRva2VuLnJlZyk7XG4gICAgICAgIGlmKG1hdGNoICE9PSBudWxsKSB7XG4gICAgICAgICAgY2FuZGlkYXRlID0gbWF0Y2hbMF07XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIlRva2VuaXplciBlcnJvcjogSW52YWxpZCB0b2tlbiBcIiArIGtleSArIFwiIHdpdGhvdXQgYSByZWcgb3IgZnVuYyBwcm9wZXJ0eVwiKTtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYoY2FuZGlkYXRlICE9PSBudWxsKSB7XG4gICAgICBsYXN0VG9rZW4gPSB7dHlwZTprZXksIHZhbHVlOmNhbmRpZGF0ZSwgcG9pbnRlcjpwb2ludGVyfTtcbiAgICAgIHN0cmVhbS5wdXNoKGxhc3RUb2tlbik7XG4gICAgICBwb2ludGVyICs9IGNhbmRpZGF0ZS5sZW5ndGg7XG4gICAgICBpbnB1dCA9IGlucHV0LnN1YnN0cihjYW5kaWRhdGUubGVuZ3RoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgaWYoc3RyZWFtLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJUb2tlbml6ZXIgZXJyb3I6IHRvdGFsIG1hdGNoIGZhaWx1cmVcIik7XG4gICAgICB9XG4gICAgICBpZihsYXN0VG9rZW4pXG4gICAgICAgIGxhc3RUb2tlbi5wb2ludGVyICs9IGxhc3RUb2tlbi52YWx1ZS5sZW5ndGg7XG4gICAgICB2YXIgbXNnID0gZXJyb3JNc2coY29weSwgc3RyZWFtW3N0cmVhbS5sZW5ndGggLSAxXSwgXCJUb2tlbml6ZXIgZXJyb3JcIiwgXCJObyBtYXRjaGluZyB0b2tlbiBmb3VuZFwiKTtcbiAgICAgIGlmKGxhc3RUb2tlbilcbiAgICAgICAgbXNnICs9IFwiXFxuXCIgKyBcIkJlZm9yZSB0b2tlbiBvZiB0eXBlIFwiICsgbGFzdFRva2VuLnR5cGUgKyBcIjogXCIgKyBsYXN0VG9rZW4udmFsdWU7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IobXNnKTtcbiAgICB9XG4gIH1cbiAgc3RyZWFtLnB1c2goe3R5cGU6J0VPRicsIHZhbHVlOlwiXCJ9KTtcbiAgcmV0dXJuIHN0cmVhbTtcbn1cblxuZnVuY3Rpb24gY29weVRva2VuKHN0b2tlbiwgcnRva2VuKSB7XG4gIHZhciB0ID0ge1xuICAgIHR5cGU6c3Rva2VuLnR5cGUsXG4gICAgdmFsdWU6c3Rva2VuLnZhbHVlLFxuICAgIHJlcGVhdDpydG9rZW4ucmVwZWF0XG4gIH07XG4gIGlmKHJ0b2tlbi5uYW1lKSB7XG4gICAgdC5uYW1lID0gcnRva2VuLm5hbWU7XG4gIH1cbiAgcmV0dXJuIHQ7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZVBhcmFtcyh0b2tlbnMpIHtcbiAgdmFyIHBhcmFtcyA9IHt9O1xuICB2YXIgaiA9IDA7XG4gIHRva2Vucy5tYXAoZnVuY3Rpb24oaSkge1xuICAgIGlmKGkubmFtZSkge1xuICAgICAgaWYoaS5yZXBlYXQgPT0gJyonIHx8IGkucmVwZWF0ID09ICcrJykge1xuICAgICAgICBpZighcGFyYW1zW2kubmFtZV0pIHtcbiAgICAgICAgICBwYXJhbXNbaS5uYW1lXSA9IFtdO1xuICAgICAgICB9XG4gICAgICAgIHBhcmFtc1tpLm5hbWVdLnB1c2goaSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBwYXJhbXNbaS5uYW1lXSA9IGk7XG4gICAgICB9XG4gICAgfVxuICAgIHBhcmFtc1snJCcral0gPSBpO1xuICAgIGorKztcbiAgfSk7XG4gIHJldHVybiBwYXJhbXM7XG59XG5cbmZ1bmN0aW9uIGdyb3dMUihncmFtbWFyLCBydWxlLCBzdHJlYW0sIHBvcywgbWVtbykge1xuICB2YXIgc3AsIHJlc3VsdCwgcHJvZ3Jlc3MgPSBmYWxzZTtcbiAgdmFyIGhvb2sgPSBncmFtbWFyW3J1bGUua2V5XS5ob29rc1tydWxlLmluZGV4XTtcblxuICB3aGlsZSh0cnVlKSB7XG4gICAgc3AgPSBwb3M7XG5cbiAgICByZXN1bHQgPSBldmFsUnVsZUJvZHkoZ3JhbW1hciwgcnVsZSwgc3RyZWFtLCBzcCk7XG5cbiAgICAvLyBlbnN1cmUgc29tZSBwcm9ncmVzcyBpcyBtYWRlXG4gICAgaWYocmVzdWx0ID09PSBmYWxzZSB8fCByZXN1bHQuc3AgPD0gbWVtby5zcCkge1xuICAgICAgcmV0dXJuIHByb2dyZXNzO1xuICAgIH1cblxuICAgIC8vIGFwcGx5IHJ1bGUgaG9va3NcbiAgICBpZihob29rICYmICFyZXN1bHQuaG9va2VkKSB7XG4gICAgICByZXN1bHQuY2hpbGRyZW4gPSBob29rKGNyZWF0ZVBhcmFtcyhyZXN1bHQuY2hpbGRyZW4pKTtcbiAgICAgIHJlc3VsdC5ob29rZWQgPSB0cnVlO1xuICAgIH1cbiAgICByZXN1bHQuaG9va2VkID0gdHJ1ZTtcblxuICAgIC8vIGl0J3MgdmVyeSBpbXBvcnRhbnQgdG8gdXBkYXRlIHRoZSBtZW1vaXplZCB2YWx1ZVxuICAgIC8vIHRoaXMgaXMgYWN0dWFsbHkgZ3Jvd2luZyB0aGUgc2VlZCBpbiB0aGUgbWVtb2l6YXRpb25cbiAgICBtZW1vLmNoaWxkcmVuID0gcmVzdWx0LmNoaWxkcmVuO1xuICAgIG1lbW8uc3AgPSByZXN1bHQuc3A7XG4gICAgbWVtby5zdGFydCA9IHJlc3VsdC5zdGFydDtcbiAgICBtZW1vLmhvb2tlZCA9IHJlc3VsdC5ob29rZWQ7XG4gICAgcHJvZ3Jlc3MgPSByZXN1bHQ7XG4gIH1cbiAgcmV0dXJuIHByb2dyZXNzO1xufVxuXG5mdW5jdGlvbiBtZW1vRXZhbChncmFtbWFyLCBydWxlLCBzdHJlYW0sIHBvaW50ZXIpIHtcblxuICB2YXIga2V5ID0gcnVsZS5rZXkrJzsnK3BvaW50ZXIrJzsnK3J1bGUuaW5kZXg7XG5cbiAgLy8gYXZvaWQgaW5maW5pdGUgcmVjdXJzaW9uXG4gIC8vIFRoaXMgaXMgZmFzdGVyIHRoYW4gZmlsdGVyXG4gIHZhciBpID0gc3RhY2subGVuZ3RoIC0gMTtcbiAgd2hpbGUoaSA+PSAwKSB7XG4gICAgaWYoc3RhY2tbaV1bMF0gPT0ga2V5KSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGkgPSBpLTE7XG4gIH1cblxuICB2YXIgbWVtb19lbnRyeSA9IG1lbW9pemF0aW9uW3J1bGUua2V5Kyc7Jytwb2ludGVyXTtcbiAgaWYobWVtb19lbnRyeSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgcmV0dXJuIG1lbW9fZW50cnk7XG4gIH1cblxuICBzdGFjay5wdXNoKFtrZXksIHJ1bGVdKTtcbiAgdmFyIHJlc3VsdCA9IGV2YWxSdWxlQm9keShncmFtbWFyLCBydWxlLCBzdHJlYW0sIHBvaW50ZXIpO1xuICBzdGFjay5wb3AoKTtcblxuICByZXR1cm4gcmVzdWx0O1xufVxuXG5mdW5jdGlvbiBjYW5GYWlsKHRva2VuLCBub2RlKSB7XG4gIGlmKHRva2VuLnJlcGVhdCA9PT0gJyonIHx8IHRva2VuLnJlcGVhdCA9PT0gJz8nKSB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cbiAgaWYodG9rZW4ucmVwZWF0ID09PSAnKycgJiYgbm9kZS5jaGlsZHJlbi5sZW5ndGggJiYgbm9kZS5jaGlsZHJlbltub2RlLmNoaWxkcmVuLmxlbmd0aCAtIDFdLnR5cGUgPT0gdG9rZW4udHlwZSkge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuZnVuY3Rpb24gY2FuUmVwZWF0KHRva2VuKSB7XG4gIHJldHVybiB0b2tlbi5yZXBlYXQgPT09ICcqJyB8fCB0b2tlbi5yZXBlYXQgPT09ICcrJztcbn1cblxuZnVuY3Rpb24gZXZhbFJ1bGVCb2R5KGdyYW1tYXIsIHJ1bGUsIHN0cmVhbSwgcG9pbnRlcikge1xuXG4gIHZhciBzcCA9IHBvaW50ZXI7IC8vIHN0cmVhbSBwb2ludGVyXG4gIHZhciBycCA9IDA7ICAgICAgIC8vIHJ1bGUgcG9pbnRlclxuICB2YXIgaiwgcmVzdWx0O1xuICB2YXIgY3VycmVudE5vZGUgPSB7dHlwZTogcnVsZS5rZXksIGNoaWxkcmVuOltdLCBzdGFydDpwb2ludGVyLCBuYW1lOnJ1bGUubmFtZX07XG5cbiAgdmFyIHJ0b2tlbiA9IHJ1bGUudG9rZW5zW3JwXTtcbiAgdmFyIHN0b2tlbiA9IHN0cmVhbVtzcF07XG5cbiAgd2hpbGUocnRva2VuICYmIHN0b2tlbikge1xuXG4gICAgLy8gQ2FzZSBvbmU6IHdlIGhhdmUgYSBydWxlIHdlIG5lZWQgdG8gZGV2ZWxvcFxuICAgIGlmKGdyYW1tYXJbcnRva2VuLnR5cGVdKSB7XG5cbiAgICAgIHZhciBleHBhbmRfcnVsZXMgPSBncmFtbWFyW3J0b2tlbi50eXBlXS5ydWxlcztcbiAgICAgIHZhciBob29rcyA9IGdyYW1tYXJbcnRva2VuLnR5cGVdLmhvb2tzO1xuICAgICAgcmVzdWx0ID0gZmFsc2U7XG5cbiAgICAgIHZhciBtID0gbWVtb2l6YXRpb25bcnRva2VuLnR5cGUrJzsnK3NwXTtcbiAgICAgIGlmKG0pIHtcbiAgICAgICAgcmVzdWx0ID0gbTtcbiAgICAgIH1cblxuICAgICAgaWYoIXJlc3VsdCkge1xuICAgICAgICBmb3Ioaj0wOyBqPGV4cGFuZF9ydWxlcy5sZW5ndGg7IGorKykge1xuICAgICAgICAgIHZhciByID0gZXhwYW5kX3J1bGVzW2pdO1xuICAgICAgICAgIHZhciBob29rID0gaG9va3MgJiYgaG9va3Nbal07XG5cbiAgICAgICAgICByZXN1bHQgPSBtZW1vRXZhbChncmFtbWFyLCByLCBzdHJlYW0sIHNwKTtcblxuICAgICAgICAgIGlmKHJlc3VsdCkge1xuXG4gICAgICAgICAgICBpZihob29rICYmICFyZXN1bHQuaG9va2VkKSB7XG4gICAgICAgICAgICAgIHJlc3VsdC5jaGlsZHJlbiA9IGhvb2soY3JlYXRlUGFyYW1zKHJlc3VsdC5jaGlsZHJlbikpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmVzdWx0Lmhvb2tlZCA9IHRydWU7XG5cbiAgICAgICAgICAgIG1lbW9pemF0aW9uW3Iua2V5Kyc7JytzcF0gPSByZXN1bHQ7XG5cbiAgICAgICAgICAgIGlmKHJ0b2tlbi5yZXBlYXQgPT09IGZhbHNlKSB7XG4gICAgICAgICAgICAgIHZhciBuX3Jlc3VsdCA9IGdyb3dMUihncmFtbWFyLCBydWxlLCBzdHJlYW0sIHNwLCByZXN1bHQpO1xuICAgICAgICAgICAgICBpZihuX3Jlc3VsdCAhPT0gZmFsc2UpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gbl9yZXN1bHQ7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZihyZXN1bHQpIHtcbiAgICAgICAgc3AgPSByZXN1bHQuc3A7XG4gICAgICAgIGN1cnJlbnROb2RlLmNoaWxkcmVuLnB1c2goe1xuICAgICAgICAgICAgdHlwZTogcnRva2VuLnR5cGUsXG4gICAgICAgICAgICBjaGlsZHJlbjpyZXN1bHQuY2hpbGRyZW4sXG4gICAgICAgICAgICBzcDpyZXN1bHQuc3AsXG4gICAgICAgICAgICBuYW1lOnJ0b2tlbi5uYW1lLFxuICAgICAgICAgICAgcmVwZWF0OiBydG9rZW4ucmVwZWF0XG4gICAgICAgICAgfSk7XG4gICAgICAgIGlmKCFjYW5SZXBlYXQocnRva2VuKSkge1xuICAgICAgICAgIHJwKys7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmKCFjYW5GYWlsKHJ0b2tlbiwgY3VycmVudE5vZGUpKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIHJwKys7XG4gICAgICB9XG5cbiAgICAvLyBDYXNlIHR3bzogd2UgaGF2ZSBhIHByb3BlciB0b2tlblxuICAgIH0gZWxzZSB7XG4gICAgICBpZihzdG9rZW4udHlwZSA9PT0gcnRva2VuLnR5cGUpIHtcbiAgICAgICAgLy9jdXJyZW50Tm9kZS5jaGlsZHJlbi5wdXNoKGNvcHlUb2tlbihzdG9rZW4sIHJ0b2tlbikpO1xuICAgICAgICBpZighcnRva2VuLm5vbkNhcHR1cmluZykge1xuICAgICAgICAgIGN1cnJlbnROb2RlLmNoaWxkcmVuLnB1c2goY29weVRva2VuKHN0b2tlbiwgcnRva2VuKSk7XG4gICAgICAgICAgc3ArKztcbiAgICAgICAgfVxuICAgICAgICBpZighY2FuUmVwZWF0KHJ0b2tlbikpIHtcbiAgICAgICAgICBycCsrO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZighY2FuRmFpbChydG9rZW4sIGN1cnJlbnROb2RlKSkge1xuICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICBycCsrO1xuICAgICAgfVxuXG4gICAgfVxuXG4gICAgLy8gaW5mb3JtYXRpb24gdXNlZCBmb3IgZGVidWdnaW5nIHB1cnBvc2VcbiAgICBpZihiZXN0X3AgPT09IHNwKSB7XG4gICAgICBiZXN0X3BhcnNlLmNhbmRpZGF0ZXMucHVzaChbcnVsZSwgcnVsZS50b2tlbnNbcnBdXSk7XG4gICAgfVxuICAgIGlmKGJlc3RfcCA8IHNwKSB7XG4gICAgICBiZXN0X3BhcnNlID0ge3NwOnNwLCBjYW5kaWRhdGVzOltbcnVsZSwgcnVsZS50b2tlbnNbcnBdXV19O1xuICAgICAgYmVzdF9wID0gc3A7XG4gICAgfVxuXG4gICAgLy8gZmV0Y2ggbmV4dCBydWxlIGFuZCBzdHJlYW0gdG9rZW5cbiAgICBydG9rZW4gPSBydWxlLnRva2Vuc1tycF07XG4gICAgc3Rva2VuID0gc3RyZWFtW3NwXTtcblxuICAgIC8vIHJ1bGUgc2F0aXNmaWVkXG4gICAgaWYocnRva2VuID09PSB1bmRlZmluZWQpIHtcbiAgICAgIGN1cnJlbnROb2RlLnNwID0gc3A7XG4gICAgICBjdXJyZW50Tm9kZS5ycCA9IHJwO1xuICAgICAgcmV0dXJuIGN1cnJlbnROb2RlO1xuICAgIH1cblxuICAgIC8vIG5vIG1vcmUgdG9rZW5zXG4gICAgaWYoc3Rva2VuID09PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmKGNhbkZhaWwocnRva2VuLCBjdXJyZW50Tm9kZSkpIHtcbiAgICAgICAgLy8gVGhpcyBkb2VzIG5vdCBoYXBwZW4gb2Z0ZW4gYmVjYXVzZSBvZiBFT0YsXG4gICAgICAgIC8vIEFzIGl0IHN0YW5kcyB0aGUgbGFzdCB0b2tlbiBhcyBhbHdheXMgdG8gYmUgRU9GXG4gICAgICAgIGN1cnJlbnROb2RlLnNwID0gc3A7XG4gICAgICAgIGN1cnJlbnROb2RlLnJwID0gcnA7XG4gICAgICAgIHJldHVybiBjdXJyZW50Tm9kZTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgfSAvLyBlbmQgcnVsZSBib2R5IGxvb3BcblxuICByZXR1cm4gZmFsc2U7XG59XG5cbmZ1bmN0aW9uIHNwbGl0VHJpbShsLCBzcGxpdCkge1xuICByZXR1cm4gbC5zcGxpdChzcGxpdCkubWFwKGZ1bmN0aW9uKGkpeyByZXR1cm4gaS50cmltKCk7IH0pO1xufVxuXG5mdW5jdGlvbiBncmFtbWFyVG9rZW4odG9rZW4pIHtcbiAgdmFyIG5vbkNhcHR1cmluZyA9IHRva2VuLmNoYXJBdCgwKSA9PT0gJyEnO1xuICBpZihub25DYXB0dXJpbmcpIHtcbiAgICB0b2tlbiA9IHRva2VuLnN1YnN0cigxKTtcbiAgfVxuICB2YXIgcmVwZWF0ID0gdG9rZW4uY2hhckF0KHRva2VuLmxlbmd0aCAtIDEpO1xuICBpZihyZXBlYXQgPT09ICcqJyB8fCByZXBlYXQgPT09ICc/JyB8fCByZXBlYXQgPT09ICcrJykge1xuICAgIHRva2VuID0gdG9rZW4uc3Vic3RyKDAsIHRva2VuLmxlbmd0aCAtIDEpO1xuICB9IGVsc2Uge1xuICAgIHJlcGVhdCA9IGZhbHNlO1xuICB9XG4gIHZhciBuYW1lZCA9IHRva2VuLnNwbGl0KFwiOlwiKSwgdDtcbiAgaWYobmFtZWQubGVuZ3RoID09PSAyKSB7XG4gICAgdCA9IHtcbiAgICAgICd0eXBlJzogbmFtZWRbMV0sXG4gICAgICAnbmFtZScgOm5hbWVkWzBdXG4gICAgfTtcbiAgfSBlbHNlIHtcbiAgICB0ID0geyd0eXBlJzogdG9rZW4gfTtcbiAgfVxuICB0LnJlcGVhdCA9IHJlcGVhdDtcbiAgaWYoKHJlcGVhdCA9PT0gJyonIHx8IHJlcGVhdCA9PT0gJysnKSAmJiBub25DYXB0dXJpbmcpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJJbXBvc3NpYmxlIHRvIGhhdmUgbm9uIGNhcHR1cmluZyB0b2tlbiB0aGF0IHJlcGVhdHNcIik7XG4gIH1cbiAgaWYobm9uQ2FwdHVyaW5nKSB7XG4gICAgdC5ub25DYXB0dXJpbmcgPSBub25DYXB0dXJpbmc7XG4gIH1cbiAgcmV0dXJuIHQ7XG59XG5cbmZ1bmN0aW9uIGNvbXBpbGVHcmFtbWFyKGdyYW1tYXIsIHRva2VuRGVmKSB7XG4gIHZhciBrZXlzID0gT2JqZWN0LmtleXMoZ3JhbW1hciksIGksIGosIGs7XG4gIHZhciBncmFtID0ge30sIG9wdGlvbmFsLCBub25DYXB0dXJpbmc7XG5cbiAgZ3JhbS50b2tlbkRlZiA9IHRva2VuRGVmO1xuICBncmFtLnRva2VuS2V5cyA9IFtdO1xuICBncmFtLnRva2VuTWFwID0ge307XG4gIHRva2VuRGVmLm1hcChmdW5jdGlvbih0KSB7XG4gICAgZ3JhbS50b2tlbk1hcFt0LmtleV0gPSB0O1xuICAgIGdyYW0udG9rZW5LZXlzLnB1c2godC5rZXkpO1xuICB9KTtcblxuICB2YXIgYWxsVmFsaWRLZXlzID0ga2V5cy5jb25jYXQoZ3JhbS50b2tlbktleXMpO1xuXG4gIGZvcihpPTA7IGk8a2V5cy5sZW5ndGg7IGkrKykge1xuICAgIHZhciBsaW5lID0gZ3JhbW1hcltrZXlzW2ldXTtcbiAgICB2YXIga2V5ID0ga2V5c1tpXTtcbiAgICB2YXIgcnVsZXMgPSBsaW5lLnJ1bGVzO1xuXG4gICAgdmFyIHNwbGl0dGVkX3J1bGVzID0gW107XG5cbiAgICBmb3Ioaj0wOyBqPHJ1bGVzLmxlbmd0aDsgaisrKSB7XG4gICAgICB2YXIgdG9rZW5zID0gc3BsaXRUcmltKHJ1bGVzW2pdLCAnICcpO1xuICAgICAgb3B0aW9uYWwgPSAwO1xuICAgICAgZm9yKGs9MDsgazx0b2tlbnMubGVuZ3RoOyBrKyspIHtcbiAgICAgICAgdmFyIHRva2VuID0gdG9rZW5zW2tdID0gZ3JhbW1hclRva2VuKHRva2Vuc1trXSk7XG4gICAgICAgIGlmKGFsbFZhbGlkS2V5cy5pbmRleE9mKHRva2VuLnR5cGUpID09PSAtMSAmJiB0b2tlbi50eXBlICE9PSAnRU9GJykge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIkludmFsaWQgdG9rZW4gdHlwZSB1c2VkIGluIHRoZSBncmFtbWFyIHJ1bGUgXCIra2V5K1wiOiBcIiArIHRva2VuLnR5cGUgKyAnLCB2YWxpZCB0b2tlbnMgYXJlOiAnK2FsbFZhbGlkS2V5cy5qb2luKCcsICcpKTtcbiAgICAgICAgfVxuICAgICAgICBpZih0b2tlbi5yZXBlYXQgPT09ICcqJykge1xuICAgICAgICAgIG9wdGlvbmFsICs9IDE7XG4gICAgICAgIH1cbiAgICAgICAgaWYodG9rZW4ubm9uQ2FwdHVyaW5nKSB7XG4gICAgICAgICAgaWYodG9rZW5zW3Rva2Vucy5sZW5ndGggLSAxXSAhPSB0b2tlbnNba10pIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIkEgbm9uIGNhcHR1cmluZyB0b2tlbiBjYW4gb25seSBiZSB0aGUgbGFzdCBvbmUgaW4gdGhlIHJ1bGU6IFwiICsgdG9rZW4udHlwZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZihvcHRpb25hbCA9PT0gdG9rZW5zLmxlbmd0aCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJSdWxlIFwiICsgcnVsZXNbal0gKyBcIiBvbmx5IGhhcyBvcHRpb25hbCBncmVlZHkgdG9rZW5zLlwiKTtcbiAgICAgIH1cbiAgICAgIHNwbGl0dGVkX3J1bGVzLnB1c2goe2tleToga2V5LCBpbmRleDpqLCB0b2tlbnM6dG9rZW5zfSk7XG4gICAgfVxuICAgIC8vIHRvZG86IHVzZSBhIHByb3BlcnR5XG4gICAgZ3JhbVtrZXldID0ge3J1bGVzOiBzcGxpdHRlZF9ydWxlcywgaG9va3M6IGxpbmUuaG9va3MgfHwgW10sIHZlcmJvc2U6bGluZS52ZXJib3NlfTtcbiAgfVxuICBncmFtLnBhcnNlID0gZnVuY3Rpb24oc3RyZWFtKSB7XG4gICAgcmV0dXJuIHBhcnNlKHN0cmVhbSwgZ3JhbSk7XG4gIH07XG4gIHJldHVybiBncmFtO1xufVxuXG5mdW5jdGlvbiBzcGFjZXIobikge1xuICB2YXIgb3V0ID0gXCJcIjtcbiAgZm9yKHZhciBpPTA7IGk8bjsgaSsrKSB7XG4gICAgb3V0ICs9IFwiIFwiO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbmZ1bmN0aW9uIGVycm9yTXNnKGlucHV0LCB0b2tlbiwgZXJyb3JUeXBlLCBtKSB7XG5cbiAgdmFyIGNoYXJuID0gdG9rZW4ucG9pbnRlciB8fCAwO1xuICB2YXIgbGluZXMgPSBpbnB1dC5zcGxpdChcIlxcblwiKSwgaSwgY2hhckNvdW50ZXIgPSAwLCBjaGFyT25MaW5lID0gMDtcblxuICBmb3IoaT0wOyBpPGxpbmVzLmxlbmd0aDsgaSsrKSB7XG4gICAgY2hhckNvdW50ZXIgKz0gbGluZXNbaV0ubGVuZ3RoICsgMTtcbiAgICBpZihjaGFyQ291bnRlciA+PSBjaGFybikge1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGNoYXJPbkxpbmUgKz0gbGluZXNbaV0ubGVuZ3RoICsgMTtcbiAgfVxuXG4gIHZhciBsbiA9IE1hdGgubWF4KDAsIGkpOyAvLyBsaW5lIG51bWJlclxuICB2YXIgbXNnID0gZXJyb3JUeXBlICsgXCIgYXQgbGluZSBcIisobG4rMSkrXCIgY2hhciBcIisgKGNoYXJuIC0gY2hhck9uTGluZSkgK1wiOiBcIjtcbiAgdmFyIGluZGljYXRvciA9IFwiXFxuXCIgKyBzcGFjZXIoKGNoYXJuIC0gY2hhck9uTGluZSkgKyAoKGxuKSArICc6ICcpLmxlbmd0aCk7XG5cbiAgaWYobGluZXNbbG4tMV0gIT09IHVuZGVmaW5lZCkge1xuICAgIG1zZyA9IG1zZyArIFwiXFxuXCIgKyAobG4pICsgJzogJyArIGxpbmVzW2xuLTFdO1xuICB9XG4gIG1zZyA9IG1zZyArIFwiXFxuXCIgKyAobG4rMSkgKyAnOiAnICsgbGluZXNbbG5dICsgaW5kaWNhdG9yO1xuICBtc2cgPSBtc2cgKyBcIl4tLSBcIiArIG07XG5cbiAgaWYobGluZXNbbG4rMV0gIT09IHVuZGVmaW5lZCkge1xuICAgIG1zZyA9IG1zZyArIFwiXFxuXCIgKyAobG4rMikgKyAnOiAnICsgbGluZXNbbG4rMV07XG4gIH1cblxuICByZXR1cm4gbXNnO1xufVxuXG5mdW5jdGlvbiB2ZXJib3NlTmFtZShncmFtbWFyLCB0eXBlKSB7XG4gIHZhciB0b2tlbmRlZiA9IGdyYW1tYXIudG9rZW5NYXBbdHlwZV07XG4gIGlmKHRva2VuZGVmICYmIHRva2VuZGVmLnZlcmJvc2UpIHtcbiAgICByZXR1cm4gdG9rZW5kZWYudmVyYm9zZTtcbiAgfVxuICBpZihncmFtbWFyW3R5cGVdICYmIGdyYW1tYXJbdHlwZV0udmVyYm9zZSkge1xuICAgIHJldHVybiBncmFtbWFyW3R5cGVdLnZlcmJvc2U7XG4gIH1cbiAgcmV0dXJuIHR5cGU7XG59XG5cbmZ1bmN0aW9uIGhpbnQoaW5wdXQsIHN0cmVhbSwgYmVzdF9wYXJzZSwgZ3JhbW1hcikge1xuICBpZighYmVzdF9wYXJzZSB8fCAhYmVzdF9wYXJzZS5jYW5kaWRhdGVzWzBdKSB7XG4gICAgcmV0dXJuIFwiQ29tcGxldGUgZmFpbHVyZSB0byBwYXJzZVwiO1xuICB9XG4gIHZhciBydWxlID0gYmVzdF9wYXJzZS5jYW5kaWRhdGVzWzBdWzBdO1xuXG4gIHZhciBhcnJheSA9IFtdO1xuICBiZXN0X3BhcnNlLmNhbmRpZGF0ZXMubWFwKGZ1bmN0aW9uKHIpIHtcbiAgICBpZighclsxXSkgeyByZXR1cm47IH1cbiAgICB2YXIgbmFtZSA9IHZlcmJvc2VOYW1lKGdyYW1tYXIsIHJbMV0udHlwZSk7XG4gICAgaWYoYXJyYXkuaW5kZXhPZihuYW1lKSA9PT0gLTEpIHtcbiAgICAgIGFycmF5LnB1c2gobmFtZSk7XG4gICAgfVxuICB9KTtcbiAgdmFyIGNhbmRpZGF0ZXMgPSBhcnJheS5qb2luKCcgb3IgJyk7XG5cbiAgdmFyIG1zZyA9IGVycm9yTXNnKGlucHV0LCBzdHJlYW1bYmVzdF9wYXJzZS5zcF0sIFwiUGFyc2VyIGVycm9yXCIsIFwiUnVsZSBcIiArIHZlcmJvc2VOYW1lKGdyYW1tYXIsIHJ1bGUua2V5KSk7XG4gIG1zZyA9IG1zZyArIFwiXFxuRXhwZWN0IFwiICsgY2FuZGlkYXRlcztcbiAgdmFyIGxhc3RUb2tlbiA9IHN0cmVhbVtiZXN0X3BhcnNlLnNwXSB8fCB7dHlwZTpcIkVPRlwifTtcbiAgbXNnID0gbXNnICsgXCJcXG5CdXQgZ290IFwiICsgdmVyYm9zZU5hbWUoZ3JhbW1hciwgbGFzdFRva2VuLnR5cGUpICsgXCIgaW5zdGVhZFwiO1xuXG4gIHJldHVybiBtc2c7XG59XG5cbi8vIHRob3NlIGFyZSBtb2R1bGUgZ2xvYmFsc1xudmFyIHN0YWNrID0gW107XG52YXIgbWVtb2l6YXRpb24gPSB7fTtcbnZhciBiZXN0X3BhcnNlID0gbnVsbDtcbnZhciBiZXN0X3AgPSAwO1xuXG5mdW5jdGlvbiBwYXJzZShpbnB1dCwgZ3JhbW1hcikge1xuICB2YXIgYmVzdFJlc3VsdCA9IHt0eXBlOidTVEFSVCcsIHNwOjAsIGNvbXBsZXRlOmZhbHNlfSwgaSwgcmVzdWx0LCBzdHJlYW07XG4gIC8vaWYodHlwZW9mIGlucHV0ID09PSAnc3RyaW5nJykge1xuICBzdHJlYW0gPSB0b2tlbml6ZShpbnB1dCwgZ3JhbW1hcik7XG4gIC8vfVxuICBiZXN0X3BhcnNlID0ge3NwOjAsIGNhbmRpZGF0ZXM6W119O1xuICBiZXN0X3AgPSAwO1xuICBmb3IoaT0wOyBpPGdyYW1tYXIuU1RBUlQucnVsZXMubGVuZ3RoOyBpKyspIHtcbiAgICBzdGFjayA9IFtdO1xuICAgIG1lbW9pemF0aW9uID0ge307XG4gICAgcmVzdWx0ID0gbWVtb0V2YWwoZ3JhbW1hciwgZ3JhbW1hci5TVEFSVC5ydWxlc1tpXSwgc3RyZWFtLCAwKTtcbiAgICBpZihyZXN1bHQgJiYgcmVzdWx0LnNwID4gYmVzdFJlc3VsdC5zcCkge1xuICAgICAgYmVzdFJlc3VsdCA9IHtcbiAgICAgICAgdHlwZTonU1RBUlQnLFxuICAgICAgICBjaGlsZHJlbjpyZXN1bHQuY2hpbGRyZW4sXG4gICAgICAgIHNwOiByZXN1bHQuc3AsXG4gICAgICAgIGNvbXBsZXRlOnJlc3VsdC5zcCA9PT0gc3RyZWFtLmxlbmd0aCxcbiAgICAgICAgaW5wdXRMZW5ndGg6c3RyZWFtLmxlbmd0aCxcbiAgICAgIH07XG4gICAgfVxuICB9XG4gIGJlc3RSZXN1bHQuYmVzdFBhcnNlID0gYmVzdF9wYXJzZTtcbiAgaWYoYmVzdF9wYXJzZSAmJiAhYmVzdFJlc3VsdC5jb21wbGV0ZSkge1xuICAgIGJlc3RSZXN1bHQuaGludCA9IGhpbnQoaW5wdXQsIHN0cmVhbSwgYmVzdF9wYXJzZSwgZ3JhbW1hcik7XG4gIH1cbiAgcmV0dXJuIGJlc3RSZXN1bHQ7XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICBwYXJzZTogcGFyc2UsXG4gIHN0YWNrOiBzdGFjayxcbiAgY29tcGlsZUdyYW1tYXI6IGNvbXBpbGVHcmFtbWFyLFxuICB0b2tlbml6ZTogdG9rZW5pemUsXG4gIG1lbW9pemF0aW9uOiBtZW1vaXphdGlvblxufTtcbiJdfQ==
