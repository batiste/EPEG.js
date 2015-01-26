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
        throw "Invalid token " + key + " without a reg or fund property";
      }
    }
    if(candidate !== null) {
      lastToken = {type:key, value:candidate, pointer:pointer};
      stream.push(lastToken);
      pointer += candidate.length;
      input = input.substr(candidate.length);
    } else {
      if(lastToken)
        lastToken.pointer += lastToken.value.length;
      var msg = errorMsg(copy, stream, stream.length - 1, "Tokenizer error", "No matching token found");
      if(lastToken)
        msg += "\n" + "Before token of type " + lastToken.type + ": " + lastToken.value;
      throw msg;
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
      if(i.repeat == '*') {
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
    throw "Impossible to have non capturing token that repeats";
  }
  if(nonCapturing) {
    t.nonCapturing = nonCapturing;
  }
  return t;
}

function compileGrammar(grammar, tokenDef) {
  var keys = Object.keys(grammar), i, j;
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
      tokens = tokens.map(function(t) {
        var token = grammarToken(t);
        if(allValidKeys.indexOf(token.type) === -1 && token.type !== 'EOF') {
          throw "Invalid token type used in the grammar: " + token.type;
        }
        if(token.repeat === '*') {
          optional += 1;
        }
        if(token.nonCapturing) {
          if(tokens[tokens.length - 1] != t) {
            throw "Non capturing token has to be the last one in the rule: " + token.type;
          }
        }
        return token;
      });
      if(optional === tokens.length) {
        throw "Rule " + rules[j] + " only has * tokens.";
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

function errorMsg(input, stream, sp, errorType, m) {

  var token = stream[sp];
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

  var msg = errorMsg(input, stream, best_parse.sp, "Parser error", "Rule " + verboseName(grammar, rule.key));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJFUEVHLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIi8qXG4gIEphdmFTY3JpcHQgaW1wbGVtZW50YXRpb24gb2YgYSBQYWNrcmF0IFBhcnNlcnMgd2l0aCBsZWZ0IFJlY3Vyc2lvbiBTdXBwb3J0XG4gIGh0dHA6Ly93d3cudnByaS5vcmcvcGRmL3RyMjAwNzAwMl9wYWNrcmF0LnBkZlxuXG4gIE5vIEluZGlyZWN0IExlZnQgUmVjdXJzaW9uIHlldCA6LShcblxuICBCYXRpc3RlIEJpZWxlciAyMDE0XG4qL1xuXCJ1c2Ugc3RyaWN0XCI7XG5cbmZ1bmN0aW9uIHRva2VuaXplKGlucHV0LCBncmFtKSB7XG4gIHZhciBrZXlzID0gZ3JhbS50b2tlbktleXM7XG4gIHZhciB0b2tlbnMgPSBncmFtLnRva2VuTWFwO1xuICB2YXIgc3RyZWFtID0gW107XG4gIHZhciBsZW4gPSBpbnB1dC5sZW5ndGgsIGNhbmRpZGF0ZSwgaSwga2V5LCBjb3B5ID0gaW5wdXQsIGxhc3RUb2tlbiA9IG51bGw7XG4gIHZhciBwb2ludGVyID0gMDtcblxuICB3aGlsZShwb2ludGVyIDwgbGVuKSB7XG4gICAgY2FuZGlkYXRlID0gbnVsbDtcbiAgICBmb3IoaT0wOyBpPGtleXMubGVuZ3RoOyBpKyspIHtcbiAgICAgIGtleSA9IGtleXNbaV07XG4gICAgICB2YXIgdG9rZW4gPSB0b2tlbnNba2V5XSwgbWF0Y2g7XG4gICAgICBpZih0b2tlbi5mdW5jKSB7XG4gICAgICAgIG1hdGNoID0gdG9rZW4uZnVuYyhpbnB1dCk7XG4gICAgICAgIGlmKG1hdGNoICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBjYW5kaWRhdGUgPSBtYXRjaDtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmKHRva2VuLnJlZyl7XG4gICAgICAgIG1hdGNoID0gaW5wdXQubWF0Y2godG9rZW4ucmVnKTtcbiAgICAgICAgaWYobWF0Y2ggIT09IG51bGwpIHtcbiAgICAgICAgICBjYW5kaWRhdGUgPSBtYXRjaFswXTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgXCJJbnZhbGlkIHRva2VuIFwiICsga2V5ICsgXCIgd2l0aG91dCBhIHJlZyBvciBmdW5kIHByb3BlcnR5XCI7XG4gICAgICB9XG4gICAgfVxuICAgIGlmKGNhbmRpZGF0ZSAhPT0gbnVsbCkge1xuICAgICAgbGFzdFRva2VuID0ge3R5cGU6a2V5LCB2YWx1ZTpjYW5kaWRhdGUsIHBvaW50ZXI6cG9pbnRlcn07XG4gICAgICBzdHJlYW0ucHVzaChsYXN0VG9rZW4pO1xuICAgICAgcG9pbnRlciArPSBjYW5kaWRhdGUubGVuZ3RoO1xuICAgICAgaW5wdXQgPSBpbnB1dC5zdWJzdHIoY2FuZGlkYXRlLmxlbmd0aCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmKGxhc3RUb2tlbilcbiAgICAgICAgbGFzdFRva2VuLnBvaW50ZXIgKz0gbGFzdFRva2VuLnZhbHVlLmxlbmd0aDtcbiAgICAgIHZhciBtc2cgPSBlcnJvck1zZyhjb3B5LCBzdHJlYW0sIHN0cmVhbS5sZW5ndGggLSAxLCBcIlRva2VuaXplciBlcnJvclwiLCBcIk5vIG1hdGNoaW5nIHRva2VuIGZvdW5kXCIpO1xuICAgICAgaWYobGFzdFRva2VuKVxuICAgICAgICBtc2cgKz0gXCJcXG5cIiArIFwiQmVmb3JlIHRva2VuIG9mIHR5cGUgXCIgKyBsYXN0VG9rZW4udHlwZSArIFwiOiBcIiArIGxhc3RUb2tlbi52YWx1ZTtcbiAgICAgIHRocm93IG1zZztcbiAgICB9XG4gIH1cbiAgc3RyZWFtLnB1c2goe3R5cGU6J0VPRicsIHZhbHVlOlwiXCJ9KTtcbiAgcmV0dXJuIHN0cmVhbTtcbn1cblxuZnVuY3Rpb24gY29weVRva2VuKHN0b2tlbiwgcnRva2VuKSB7XG4gIHZhciB0ID0ge1xuICAgIHR5cGU6c3Rva2VuLnR5cGUsXG4gICAgdmFsdWU6c3Rva2VuLnZhbHVlLFxuICAgIHJlcGVhdDpydG9rZW4ucmVwZWF0XG4gIH07XG4gIGlmKHJ0b2tlbi5uYW1lKSB7XG4gICAgdC5uYW1lID0gcnRva2VuLm5hbWU7XG4gIH1cbiAgcmV0dXJuIHQ7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZVBhcmFtcyh0b2tlbnMpIHtcbiAgdmFyIHBhcmFtcyA9IHt9O1xuICB2YXIgaiA9IDA7XG4gIHRva2Vucy5tYXAoZnVuY3Rpb24oaSkge1xuICAgIGlmKGkubmFtZSkge1xuICAgICAgaWYoaS5yZXBlYXQgPT0gJyonKSB7XG4gICAgICAgIGlmKCFwYXJhbXNbaS5uYW1lXSkge1xuICAgICAgICAgIHBhcmFtc1tpLm5hbWVdID0gW107XG4gICAgICAgIH1cbiAgICAgICAgcGFyYW1zW2kubmFtZV0ucHVzaChpKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHBhcmFtc1tpLm5hbWVdID0gaTtcbiAgICAgIH1cbiAgICB9XG4gICAgcGFyYW1zWyckJytqXSA9IGk7XG4gICAgaisrO1xuICB9KTtcbiAgcmV0dXJuIHBhcmFtcztcbn1cblxuZnVuY3Rpb24gZ3Jvd0xSKGdyYW1tYXIsIHJ1bGUsIHN0cmVhbSwgcG9zLCBtZW1vKSB7XG4gIHZhciBzcCwgcmVzdWx0LCBwcm9ncmVzcyA9IGZhbHNlO1xuICB2YXIgaG9vayA9IGdyYW1tYXJbcnVsZS5rZXldLmhvb2tzW3J1bGUuaW5kZXhdO1xuXG4gIHdoaWxlKHRydWUpIHtcbiAgICBzcCA9IHBvcztcblxuICAgIHJlc3VsdCA9IGV2YWxSdWxlQm9keShncmFtbWFyLCBydWxlLCBzdHJlYW0sIHNwKTtcblxuICAgIC8vIGVuc3VyZSBzb21lIHByb2dyZXNzIGlzIG1hZGVcbiAgICBpZihyZXN1bHQgPT09IGZhbHNlIHx8IHJlc3VsdC5zcCA8PSBtZW1vLnNwKSB7XG4gICAgICByZXR1cm4gcHJvZ3Jlc3M7XG4gICAgfVxuXG4gICAgLy8gYXBwbHkgcnVsZSBob29rc1xuICAgIGlmKGhvb2sgJiYgIXJlc3VsdC5ob29rZWQpIHtcbiAgICAgIHJlc3VsdC5jaGlsZHJlbiA9IGhvb2soY3JlYXRlUGFyYW1zKHJlc3VsdC5jaGlsZHJlbikpO1xuICAgICAgcmVzdWx0Lmhvb2tlZCA9IHRydWU7XG4gICAgfVxuICAgIHJlc3VsdC5ob29rZWQgPSB0cnVlO1xuXG4gICAgLy8gaXQncyB2ZXJ5IGltcG9ydGFudCB0byB1cGRhdGUgdGhlIG1lbW9pemVkIHZhbHVlXG4gICAgLy8gdGhpcyBpcyBhY3R1YWxseSBncm93aW5nIHRoZSBzZWVkIGluIHRoZSBtZW1vaXphdGlvblxuICAgIG1lbW8uY2hpbGRyZW4gPSByZXN1bHQuY2hpbGRyZW47XG4gICAgbWVtby5zcCA9IHJlc3VsdC5zcDtcbiAgICBtZW1vLnN0YXJ0ID0gcmVzdWx0LnN0YXJ0O1xuICAgIG1lbW8uaG9va2VkID0gcmVzdWx0Lmhvb2tlZDtcbiAgICBwcm9ncmVzcyA9IHJlc3VsdDtcbiAgfVxuICByZXR1cm4gcHJvZ3Jlc3M7XG59XG5cbmZ1bmN0aW9uIG1lbW9FdmFsKGdyYW1tYXIsIHJ1bGUsIHN0cmVhbSwgcG9pbnRlcikge1xuXG4gIHZhciBrZXkgPSBydWxlLmtleSsnOycrcG9pbnRlcisnOycrcnVsZS5pbmRleDtcblxuICAvLyBhdm9pZCBpbmZpbml0ZSByZWN1cnNpb25cbiAgLy8gVGhpcyBpcyBmYXN0ZXIgdGhhbiBmaWx0ZXJcbiAgdmFyIGkgPSBzdGFjay5sZW5ndGggLSAxO1xuICB3aGlsZShpID49IDApIHtcbiAgICBpZihzdGFja1tpXVswXSA9PSBrZXkpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgaSA9IGktMTtcbiAgfVxuXG4gIHZhciBtZW1vX2VudHJ5ID0gbWVtb2l6YXRpb25bcnVsZS5rZXkrJzsnK3BvaW50ZXJdO1xuICBpZihtZW1vX2VudHJ5ICE9PSB1bmRlZmluZWQpIHtcbiAgICByZXR1cm4gbWVtb19lbnRyeTtcbiAgfVxuXG4gIHN0YWNrLnB1c2goW2tleSwgcnVsZV0pO1xuICB2YXIgcmVzdWx0ID0gZXZhbFJ1bGVCb2R5KGdyYW1tYXIsIHJ1bGUsIHN0cmVhbSwgcG9pbnRlcik7XG4gIHN0YWNrLnBvcCgpO1xuXG4gIHJldHVybiByZXN1bHQ7XG59XG5cbmZ1bmN0aW9uIGNhbkZhaWwodG9rZW4sIG5vZGUpIHtcbiAgaWYodG9rZW4ucmVwZWF0ID09PSAnKicgfHwgdG9rZW4ucmVwZWF0ID09PSAnPycpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuICBpZih0b2tlbi5yZXBlYXQgPT09ICcrJyAmJiBub2RlLmNoaWxkcmVuLmxlbmd0aCAmJiBub2RlLmNoaWxkcmVuW25vZGUuY2hpbGRyZW4ubGVuZ3RoIC0gMV0udHlwZSA9PSB0b2tlbi50eXBlKSB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG5mdW5jdGlvbiBjYW5SZXBlYXQodG9rZW4pIHtcbiAgcmV0dXJuIHRva2VuLnJlcGVhdCA9PT0gJyonIHx8IHRva2VuLnJlcGVhdCA9PT0gJysnO1xufVxuXG5mdW5jdGlvbiBldmFsUnVsZUJvZHkoZ3JhbW1hciwgcnVsZSwgc3RyZWFtLCBwb2ludGVyKSB7XG5cbiAgdmFyIHNwID0gcG9pbnRlcjsgLy8gc3RyZWFtIHBvaW50ZXJcbiAgdmFyIHJwID0gMDsgICAgICAgLy8gcnVsZSBwb2ludGVyXG4gIHZhciBqLCByZXN1bHQ7XG4gIHZhciBjdXJyZW50Tm9kZSA9IHt0eXBlOiBydWxlLmtleSwgY2hpbGRyZW46W10sIHN0YXJ0OnBvaW50ZXIsIG5hbWU6cnVsZS5uYW1lfTtcblxuICB2YXIgcnRva2VuID0gcnVsZS50b2tlbnNbcnBdO1xuICB2YXIgc3Rva2VuID0gc3RyZWFtW3NwXTtcblxuICB3aGlsZShydG9rZW4gJiYgc3Rva2VuKSB7XG5cbiAgICAvLyBDYXNlIG9uZTogd2UgaGF2ZSBhIHJ1bGUgd2UgbmVlZCB0byBkZXZlbG9wXG4gICAgaWYoZ3JhbW1hcltydG9rZW4udHlwZV0pIHtcblxuICAgICAgdmFyIGV4cGFuZF9ydWxlcyA9IGdyYW1tYXJbcnRva2VuLnR5cGVdLnJ1bGVzO1xuICAgICAgdmFyIGhvb2tzID0gZ3JhbW1hcltydG9rZW4udHlwZV0uaG9va3M7XG4gICAgICByZXN1bHQgPSBmYWxzZTtcblxuICAgICAgdmFyIG0gPSBtZW1vaXphdGlvbltydG9rZW4udHlwZSsnOycrc3BdO1xuICAgICAgaWYobSkge1xuICAgICAgICByZXN1bHQgPSBtO1xuICAgICAgfVxuXG4gICAgICBpZighcmVzdWx0KSB7XG4gICAgICAgIGZvcihqPTA7IGo8ZXhwYW5kX3J1bGVzLmxlbmd0aDsgaisrKSB7XG4gICAgICAgICAgdmFyIHIgPSBleHBhbmRfcnVsZXNbal07XG4gICAgICAgICAgdmFyIGhvb2sgPSBob29rcyAmJiBob29rc1tqXTtcblxuICAgICAgICAgIHJlc3VsdCA9IG1lbW9FdmFsKGdyYW1tYXIsIHIsIHN0cmVhbSwgc3ApO1xuXG4gICAgICAgICAgaWYocmVzdWx0KSB7XG5cbiAgICAgICAgICAgIGlmKGhvb2sgJiYgIXJlc3VsdC5ob29rZWQpIHtcbiAgICAgICAgICAgICAgcmVzdWx0LmNoaWxkcmVuID0gaG9vayhjcmVhdGVQYXJhbXMocmVzdWx0LmNoaWxkcmVuKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXN1bHQuaG9va2VkID0gdHJ1ZTtcblxuICAgICAgICAgICAgbWVtb2l6YXRpb25bci5rZXkrJzsnK3NwXSA9IHJlc3VsdDtcblxuICAgICAgICAgICAgaWYocnRva2VuLnJlcGVhdCA9PT0gZmFsc2UpIHtcbiAgICAgICAgICAgICAgdmFyIG5fcmVzdWx0ID0gZ3Jvd0xSKGdyYW1tYXIsIHJ1bGUsIHN0cmVhbSwgc3AsIHJlc3VsdCk7XG4gICAgICAgICAgICAgIGlmKG5fcmVzdWx0ICE9PSBmYWxzZSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBuX3Jlc3VsdDtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmKHJlc3VsdCkge1xuICAgICAgICBzcCA9IHJlc3VsdC5zcDtcbiAgICAgICAgY3VycmVudE5vZGUuY2hpbGRyZW4ucHVzaCh7XG4gICAgICAgICAgICB0eXBlOiBydG9rZW4udHlwZSxcbiAgICAgICAgICAgIGNoaWxkcmVuOnJlc3VsdC5jaGlsZHJlbixcbiAgICAgICAgICAgIHNwOnJlc3VsdC5zcCxcbiAgICAgICAgICAgIG5hbWU6cnRva2VuLm5hbWUsXG4gICAgICAgICAgICByZXBlYXQ6IHJ0b2tlbi5yZXBlYXRcbiAgICAgICAgICB9KTtcbiAgICAgICAgaWYoIWNhblJlcGVhdChydG9rZW4pKSB7XG4gICAgICAgICAgcnArKztcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYoIWNhbkZhaWwocnRva2VuLCBjdXJyZW50Tm9kZSkpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgcnArKztcbiAgICAgIH1cblxuICAgIC8vIENhc2UgdHdvOiB3ZSBoYXZlIGEgcHJvcGVyIHRva2VuXG4gICAgfSBlbHNlIHtcbiAgICAgIGlmKHN0b2tlbi50eXBlID09PSBydG9rZW4udHlwZSkge1xuICAgICAgICAvL2N1cnJlbnROb2RlLmNoaWxkcmVuLnB1c2goY29weVRva2VuKHN0b2tlbiwgcnRva2VuKSk7XG4gICAgICAgIGlmKCFydG9rZW4ubm9uQ2FwdHVyaW5nKSB7XG4gICAgICAgICAgY3VycmVudE5vZGUuY2hpbGRyZW4ucHVzaChjb3B5VG9rZW4oc3Rva2VuLCBydG9rZW4pKTtcbiAgICAgICAgICBzcCsrO1xuICAgICAgICB9XG4gICAgICAgIGlmKCFjYW5SZXBlYXQocnRva2VuKSkge1xuICAgICAgICAgIHJwKys7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmKCFjYW5GYWlsKHJ0b2tlbiwgY3VycmVudE5vZGUpKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIHJwKys7XG4gICAgICB9XG5cbiAgICB9XG5cbiAgICAvLyBpbmZvcm1hdGlvbiB1c2VkIGZvciBkZWJ1Z2dpbmcgcHVycG9zZVxuICAgIGlmKGJlc3RfcCA9PT0gc3ApIHtcbiAgICAgIGJlc3RfcGFyc2UuY2FuZGlkYXRlcy5wdXNoKFtydWxlLCBydWxlLnRva2Vuc1tycF1dKTtcbiAgICB9XG4gICAgaWYoYmVzdF9wIDwgc3ApIHtcbiAgICAgIGJlc3RfcGFyc2UgPSB7c3A6c3AsIGNhbmRpZGF0ZXM6W1tydWxlLCBydWxlLnRva2Vuc1tycF1dXX07XG4gICAgICBiZXN0X3AgPSBzcDtcbiAgICB9XG5cbiAgICAvLyBmZXRjaCBuZXh0IHJ1bGUgYW5kIHN0cmVhbSB0b2tlblxuICAgIHJ0b2tlbiA9IHJ1bGUudG9rZW5zW3JwXTtcbiAgICBzdG9rZW4gPSBzdHJlYW1bc3BdO1xuXG4gICAgLy8gcnVsZSBzYXRpc2ZpZWRcbiAgICBpZihydG9rZW4gPT09IHVuZGVmaW5lZCkge1xuICAgICAgY3VycmVudE5vZGUuc3AgPSBzcDtcbiAgICAgIGN1cnJlbnROb2RlLnJwID0gcnA7XG4gICAgICByZXR1cm4gY3VycmVudE5vZGU7XG4gICAgfVxuXG4gICAgLy8gbm8gbW9yZSB0b2tlbnNcbiAgICBpZihzdG9rZW4gPT09IHVuZGVmaW5lZCkge1xuICAgICAgaWYoY2FuRmFpbChydG9rZW4sIGN1cnJlbnROb2RlKSkge1xuICAgICAgICAvLyBUaGlzIGRvZXMgbm90IGhhcHBlbiBvZnRlbiBiZWNhdXNlIG9mIEVPRixcbiAgICAgICAgLy8gQXMgaXQgc3RhbmRzIHRoZSBsYXN0IHRva2VuIGFzIGFsd2F5cyB0byBiZSBFT0ZcbiAgICAgICAgY3VycmVudE5vZGUuc3AgPSBzcDtcbiAgICAgICAgY3VycmVudE5vZGUucnAgPSBycDtcbiAgICAgICAgcmV0dXJuIGN1cnJlbnROb2RlO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICB9IC8vIGVuZCBydWxlIGJvZHkgbG9vcFxuXG4gIHJldHVybiBmYWxzZTtcbn1cblxuZnVuY3Rpb24gc3BsaXRUcmltKGwsIHNwbGl0KSB7XG4gIHJldHVybiBsLnNwbGl0KHNwbGl0KS5tYXAoZnVuY3Rpb24oaSl7IHJldHVybiBpLnRyaW0oKTsgfSk7XG59XG5cbmZ1bmN0aW9uIGdyYW1tYXJUb2tlbih0b2tlbikge1xuICB2YXIgbm9uQ2FwdHVyaW5nID0gdG9rZW4uY2hhckF0KDApID09PSAnISc7XG4gIGlmKG5vbkNhcHR1cmluZykge1xuICAgIHRva2VuID0gdG9rZW4uc3Vic3RyKDEpO1xuICB9XG4gIHZhciByZXBlYXQgPSB0b2tlbi5jaGFyQXQodG9rZW4ubGVuZ3RoIC0gMSk7XG4gIGlmKHJlcGVhdCA9PT0gJyonIHx8IHJlcGVhdCA9PT0gJz8nIHx8IHJlcGVhdCA9PT0gJysnKSB7XG4gICAgdG9rZW4gPSB0b2tlbi5zdWJzdHIoMCwgdG9rZW4ubGVuZ3RoIC0gMSk7XG4gIH0gZWxzZSB7XG4gICAgcmVwZWF0ID0gZmFsc2U7XG4gIH1cbiAgdmFyIG5hbWVkID0gdG9rZW4uc3BsaXQoXCI6XCIpLCB0O1xuICBpZihuYW1lZC5sZW5ndGggPT09IDIpIHtcbiAgICB0ID0ge1xuICAgICAgJ3R5cGUnOiBuYW1lZFsxXSxcbiAgICAgICduYW1lJyA6bmFtZWRbMF1cbiAgICB9O1xuICB9IGVsc2Uge1xuICAgIHQgPSB7J3R5cGUnOiB0b2tlbiB9O1xuICB9XG4gIHQucmVwZWF0ID0gcmVwZWF0O1xuICBpZigocmVwZWF0ID09PSAnKicgfHwgcmVwZWF0ID09PSAnKycpICYmIG5vbkNhcHR1cmluZykge1xuICAgIHRocm93IFwiSW1wb3NzaWJsZSB0byBoYXZlIG5vbiBjYXB0dXJpbmcgdG9rZW4gdGhhdCByZXBlYXRzXCI7XG4gIH1cbiAgaWYobm9uQ2FwdHVyaW5nKSB7XG4gICAgdC5ub25DYXB0dXJpbmcgPSBub25DYXB0dXJpbmc7XG4gIH1cbiAgcmV0dXJuIHQ7XG59XG5cbmZ1bmN0aW9uIGNvbXBpbGVHcmFtbWFyKGdyYW1tYXIsIHRva2VuRGVmKSB7XG4gIHZhciBrZXlzID0gT2JqZWN0LmtleXMoZ3JhbW1hciksIGksIGo7XG4gIHZhciBncmFtID0ge30sIG9wdGlvbmFsLCBub25DYXB0dXJpbmc7XG5cbiAgZ3JhbS50b2tlbkRlZiA9IHRva2VuRGVmO1xuICBncmFtLnRva2VuS2V5cyA9IFtdO1xuICBncmFtLnRva2VuTWFwID0ge307XG4gIHRva2VuRGVmLm1hcChmdW5jdGlvbih0KSB7XG4gICAgZ3JhbS50b2tlbk1hcFt0LmtleV0gPSB0O1xuICAgIGdyYW0udG9rZW5LZXlzLnB1c2godC5rZXkpO1xuICB9KTtcblxuICB2YXIgYWxsVmFsaWRLZXlzID0ga2V5cy5jb25jYXQoZ3JhbS50b2tlbktleXMpO1xuXG4gIGZvcihpPTA7IGk8a2V5cy5sZW5ndGg7IGkrKykge1xuICAgIHZhciBsaW5lID0gZ3JhbW1hcltrZXlzW2ldXTtcbiAgICB2YXIga2V5ID0ga2V5c1tpXTtcbiAgICB2YXIgcnVsZXMgPSBsaW5lLnJ1bGVzO1xuXG4gICAgdmFyIHNwbGl0dGVkX3J1bGVzID0gW107XG5cbiAgICBmb3Ioaj0wOyBqPHJ1bGVzLmxlbmd0aDsgaisrKSB7XG4gICAgICB2YXIgdG9rZW5zID0gc3BsaXRUcmltKHJ1bGVzW2pdLCAnICcpO1xuICAgICAgb3B0aW9uYWwgPSAwO1xuICAgICAgdG9rZW5zID0gdG9rZW5zLm1hcChmdW5jdGlvbih0KSB7XG4gICAgICAgIHZhciB0b2tlbiA9IGdyYW1tYXJUb2tlbih0KTtcbiAgICAgICAgaWYoYWxsVmFsaWRLZXlzLmluZGV4T2YodG9rZW4udHlwZSkgPT09IC0xICYmIHRva2VuLnR5cGUgIT09ICdFT0YnKSB7XG4gICAgICAgICAgdGhyb3cgXCJJbnZhbGlkIHRva2VuIHR5cGUgdXNlZCBpbiB0aGUgZ3JhbW1hcjogXCIgKyB0b2tlbi50eXBlO1xuICAgICAgICB9XG4gICAgICAgIGlmKHRva2VuLnJlcGVhdCA9PT0gJyonKSB7XG4gICAgICAgICAgb3B0aW9uYWwgKz0gMTtcbiAgICAgICAgfVxuICAgICAgICBpZih0b2tlbi5ub25DYXB0dXJpbmcpIHtcbiAgICAgICAgICBpZih0b2tlbnNbdG9rZW5zLmxlbmd0aCAtIDFdICE9IHQpIHtcbiAgICAgICAgICAgIHRocm93IFwiTm9uIGNhcHR1cmluZyB0b2tlbiBoYXMgdG8gYmUgdGhlIGxhc3Qgb25lIGluIHRoZSBydWxlOiBcIiArIHRva2VuLnR5cGU7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0b2tlbjtcbiAgICAgIH0pO1xuICAgICAgaWYob3B0aW9uYWwgPT09IHRva2Vucy5sZW5ndGgpIHtcbiAgICAgICAgdGhyb3cgXCJSdWxlIFwiICsgcnVsZXNbal0gKyBcIiBvbmx5IGhhcyAqIHRva2Vucy5cIjtcbiAgICAgIH1cbiAgICAgIHNwbGl0dGVkX3J1bGVzLnB1c2goe2tleToga2V5LCBpbmRleDpqLCB0b2tlbnM6dG9rZW5zfSk7XG4gICAgfVxuICAgIC8vIHRvZG86IHVzZSBhIHByb3BlcnR5XG4gICAgZ3JhbVtrZXldID0ge3J1bGVzOiBzcGxpdHRlZF9ydWxlcywgaG9va3M6IGxpbmUuaG9va3MgfHwgW10sIHZlcmJvc2U6bGluZS52ZXJib3NlfTtcbiAgfVxuICBncmFtLnBhcnNlID0gZnVuY3Rpb24oc3RyZWFtKSB7XG4gICAgcmV0dXJuIHBhcnNlKHN0cmVhbSwgZ3JhbSk7XG4gIH07XG4gIHJldHVybiBncmFtO1xufVxuXG5mdW5jdGlvbiBzcGFjZXIobikge1xuICB2YXIgb3V0ID0gXCJcIjtcbiAgZm9yKHZhciBpPTA7IGk8bjsgaSsrKSB7XG4gICAgb3V0ICs9IFwiIFwiO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbmZ1bmN0aW9uIGVycm9yTXNnKGlucHV0LCBzdHJlYW0sIHNwLCBlcnJvclR5cGUsIG0pIHtcblxuICB2YXIgdG9rZW4gPSBzdHJlYW1bc3BdO1xuICB2YXIgY2hhcm4gPSB0b2tlbi5wb2ludGVyIHx8IDA7XG4gIHZhciBsaW5lcyA9IGlucHV0LnNwbGl0KFwiXFxuXCIpLCBpLCBjaGFyQ291bnRlciA9IDAsIGNoYXJPbkxpbmUgPSAwO1xuXG4gIGZvcihpPTA7IGk8bGluZXMubGVuZ3RoOyBpKyspIHtcbiAgICBjaGFyQ291bnRlciArPSBsaW5lc1tpXS5sZW5ndGggKyAxO1xuICAgIGlmKGNoYXJDb3VudGVyID49IGNoYXJuKSB7XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgY2hhck9uTGluZSArPSBsaW5lc1tpXS5sZW5ndGggKyAxO1xuICB9XG5cbiAgdmFyIGxuID0gTWF0aC5tYXgoMCwgaSk7IC8vIGxpbmUgbnVtYmVyXG4gIHZhciBtc2cgPSBlcnJvclR5cGUgKyBcIiBhdCBsaW5lIFwiKyhsbisxKStcIiBjaGFyIFwiKyAoY2hhcm4gLSBjaGFyT25MaW5lKSArXCI6IFwiO1xuICB2YXIgaW5kaWNhdG9yID0gXCJcXG5cIiArIHNwYWNlcigoY2hhcm4gLSBjaGFyT25MaW5lKSArICgobG4pICsgJzogJykubGVuZ3RoKTtcblxuICBpZihsaW5lc1tsbi0xXSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgbXNnID0gbXNnICsgXCJcXG5cIiArIChsbikgKyAnOiAnICsgbGluZXNbbG4tMV07XG4gIH1cbiAgbXNnID0gbXNnICsgXCJcXG5cIiArIChsbisxKSArICc6ICcgKyBsaW5lc1tsbl0gKyBpbmRpY2F0b3I7XG4gIG1zZyA9IG1zZyArIFwiXi0tIFwiICsgbTtcblxuICBpZihsaW5lc1tsbisxXSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgbXNnID0gbXNnICsgXCJcXG5cIiArIChsbisyKSArICc6ICcgKyBsaW5lc1tsbisxXTtcbiAgfVxuXG4gIHJldHVybiBtc2c7XG59XG5cbmZ1bmN0aW9uIHZlcmJvc2VOYW1lKGdyYW1tYXIsIHR5cGUpIHtcbiAgdmFyIHRva2VuZGVmID0gZ3JhbW1hci50b2tlbk1hcFt0eXBlXTtcbiAgaWYodG9rZW5kZWYgJiYgdG9rZW5kZWYudmVyYm9zZSkge1xuICAgIHJldHVybiB0b2tlbmRlZi52ZXJib3NlO1xuICB9XG4gIGlmKGdyYW1tYXJbdHlwZV0gJiYgZ3JhbW1hclt0eXBlXS52ZXJib3NlKSB7XG4gICAgcmV0dXJuIGdyYW1tYXJbdHlwZV0udmVyYm9zZTtcbiAgfVxuICByZXR1cm4gdHlwZTtcbn1cblxuZnVuY3Rpb24gaGludChpbnB1dCwgc3RyZWFtLCBiZXN0X3BhcnNlLCBncmFtbWFyKSB7XG4gIGlmKCFiZXN0X3BhcnNlIHx8ICFiZXN0X3BhcnNlLmNhbmRpZGF0ZXNbMF0pIHtcbiAgICByZXR1cm4gXCJDb21wbGV0ZSBmYWlsdXJlIHRvIHBhcnNlXCI7XG4gIH1cbiAgdmFyIHJ1bGUgPSBiZXN0X3BhcnNlLmNhbmRpZGF0ZXNbMF1bMF07XG5cbiAgdmFyIGFycmF5ID0gW107XG4gIGJlc3RfcGFyc2UuY2FuZGlkYXRlcy5tYXAoZnVuY3Rpb24ocikge1xuICAgIGlmKCFyWzFdKSB7IHJldHVybjsgfVxuICAgIHZhciBuYW1lID0gdmVyYm9zZU5hbWUoZ3JhbW1hciwgclsxXS50eXBlKTtcbiAgICBpZihhcnJheS5pbmRleE9mKG5hbWUpID09PSAtMSkge1xuICAgICAgYXJyYXkucHVzaChuYW1lKTtcbiAgICB9XG4gIH0pO1xuICB2YXIgY2FuZGlkYXRlcyA9IGFycmF5LmpvaW4oJyBvciAnKTtcblxuICB2YXIgbXNnID0gZXJyb3JNc2coaW5wdXQsIHN0cmVhbSwgYmVzdF9wYXJzZS5zcCwgXCJQYXJzZXIgZXJyb3JcIiwgXCJSdWxlIFwiICsgdmVyYm9zZU5hbWUoZ3JhbW1hciwgcnVsZS5rZXkpKTtcbiAgbXNnID0gbXNnICsgXCJcXG5FeHBlY3QgXCIgKyBjYW5kaWRhdGVzO1xuICB2YXIgbGFzdFRva2VuID0gc3RyZWFtW2Jlc3RfcGFyc2Uuc3BdIHx8IHt0eXBlOlwiRU9GXCJ9O1xuICBtc2cgPSBtc2cgKyBcIlxcbkJ1dCBnb3QgXCIgKyB2ZXJib3NlTmFtZShncmFtbWFyLCBsYXN0VG9rZW4udHlwZSkgKyBcIiBpbnN0ZWFkXCI7XG5cbiAgcmV0dXJuIG1zZztcbn1cblxuLy8gdGhvc2UgYXJlIG1vZHVsZSBnbG9iYWxzXG52YXIgc3RhY2sgPSBbXTtcbnZhciBtZW1vaXphdGlvbiA9IHt9O1xudmFyIGJlc3RfcGFyc2UgPSBudWxsO1xudmFyIGJlc3RfcCA9IDA7XG5cbmZ1bmN0aW9uIHBhcnNlKGlucHV0LCBncmFtbWFyKSB7XG4gIHZhciBiZXN0UmVzdWx0ID0ge3R5cGU6J1NUQVJUJywgc3A6MCwgY29tcGxldGU6ZmFsc2V9LCBpLCByZXN1bHQsIHN0cmVhbTtcbiAgLy9pZih0eXBlb2YgaW5wdXQgPT09ICdzdHJpbmcnKSB7XG4gIHN0cmVhbSA9IHRva2VuaXplKGlucHV0LCBncmFtbWFyKTtcbiAgLy99XG4gIGJlc3RfcGFyc2UgPSB7c3A6MCwgY2FuZGlkYXRlczpbXX07XG4gIGJlc3RfcCA9IDA7XG4gIGZvcihpPTA7IGk8Z3JhbW1hci5TVEFSVC5ydWxlcy5sZW5ndGg7IGkrKykge1xuICAgIHN0YWNrID0gW107XG4gICAgbWVtb2l6YXRpb24gPSB7fTtcbiAgICByZXN1bHQgPSBtZW1vRXZhbChncmFtbWFyLCBncmFtbWFyLlNUQVJULnJ1bGVzW2ldLCBzdHJlYW0sIDApO1xuICAgIGlmKHJlc3VsdCAmJiByZXN1bHQuc3AgPiBiZXN0UmVzdWx0LnNwKSB7XG4gICAgICBiZXN0UmVzdWx0ID0ge1xuICAgICAgICB0eXBlOidTVEFSVCcsXG4gICAgICAgIGNoaWxkcmVuOnJlc3VsdC5jaGlsZHJlbixcbiAgICAgICAgc3A6IHJlc3VsdC5zcCxcbiAgICAgICAgY29tcGxldGU6cmVzdWx0LnNwID09PSBzdHJlYW0ubGVuZ3RoLFxuICAgICAgICBpbnB1dExlbmd0aDpzdHJlYW0ubGVuZ3RoLFxuICAgICAgfTtcbiAgICB9XG4gIH1cbiAgYmVzdFJlc3VsdC5iZXN0UGFyc2UgPSBiZXN0X3BhcnNlO1xuICBpZihiZXN0X3BhcnNlICYmICFiZXN0UmVzdWx0LmNvbXBsZXRlKSB7XG4gICAgYmVzdFJlc3VsdC5oaW50ID0gaGludChpbnB1dCwgc3RyZWFtLCBiZXN0X3BhcnNlLCBncmFtbWFyKTtcbiAgfVxuICByZXR1cm4gYmVzdFJlc3VsdDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIHBhcnNlOiBwYXJzZSxcbiAgc3RhY2s6IHN0YWNrLFxuICBjb21waWxlR3JhbW1hcjogY29tcGlsZUdyYW1tYXIsXG4gIHRva2VuaXplOiB0b2tlbml6ZSxcbiAgbWVtb2l6YXRpb246IG1lbW9pemF0aW9uXG59OyJdfQ==
