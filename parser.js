/*
  JavaScript implementation of a Packrat Parsers with left Recursion Support
  http://www.vpri.org/pdf/tr2007002_packrat.pdf

  No Indirect Left Recursion yet :-(

  Batiste Bieler 2014
*/

(function(){
"use strict";

function tokenize(input, tokens) {
  // this keep the order of declaration
  var keys = Object.keys(tokens);
  var stream = [];
  var len = input.length, candidate, i, candidate_key;

  while(len > 0) {
    candidate = null;
    for(i=0; i<keys.length; i++) {
      var key = keys[i];
      var token = tokens[key], match;
      if(typeof token === 'function') {
        match = token(input) || null;
        if(match !== null) {
          match = [match];
        }
      } else {
        match = input.match(token);
      }
      if(match !== null) {
        // the algo is not greedy
        candidate = match[0];
        candidate_key = key;
        break;
      }
    }
    if(candidate && candidate.length > 0) {
      stream.push({type:candidate_key, value:candidate});
      input = input.substr(candidate.length);
      len = input.length;
    } else {
      throw "No matching token found near " + input.substr(0, 12);
    }
  }
  stream.push({type:'EOF', value:""});
  return stream;
}

function copyToken(stoken, rtoken) {
  if(rtoken.name) {
    return {type:stoken.type,
      value:stoken.value,
      name:rtoken.name,
      repeat:rtoken.repeat};
  }
  return {type:stoken.type,
    value:stoken.value,
    repeat:rtoken.repeat};
}

function createParams(tokens) {
  var params = {};
  var j = 0;
  tokens.map(function(i) {
    if(i.name) {
      if(i.repeat) {
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
  while(true) {
    sp = pos;
    result = evalRuleBody(grammar, rule, stream, sp);

    // ensure some progress is made
    if(result === false || result.sp <= memo.sp) {
      return progress;
    }

    memo.children = result.children;
    memo.sp = result.sp;
    memo.start = result.start;
    progress = memo;
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

function evalRuleBody(grammar, rule, stream, pointer) {

  var sp = pointer; // stream pointer
  var rp = 0; // rule pointer
  var j, result;
  var currentNode = {type: rule.key, children:[], start:pointer, name:rule.name};

  var rtoken = rule.tokens[rp];
  var stoken = stream[sp];

  while(rtoken && stoken) {

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

          result = memoEval(grammar, r, stream, sp);

          if(result) {
            if(hooks && hooks[j]) {
              result.children = hooks[j](createParams(result.children));
            }

            //if(!memoization[r.key+';'+sp])
            memoization[r.key+';'+sp] = result;

            var n_result = growLR(grammar, rule, stream, sp, result);

            if(n_result !== false) {
              return n_result;
            }
            break;
          }
        }
      }

      if(result) {
        sp = result.sp;
        currentNode.children.push({type: rtoken.type, children:result.children, sp:result.sp, name:rtoken.name});
        if(rtoken.repeat === false || rtoken.repeat === '?') {
          rp++;
        }
      } else {
        if(rtoken.repeat === false) {
          return false;
        }
        rp++;
      }

    } else {

      if(stoken.type === rtoken.type) {
        currentNode.children.push(copyToken(stoken, rtoken));
        if(rtoken.repeat === false || rtoken.repeat === '?') {
          rp++;
        }
        sp++;
      } else {
        if(rtoken.repeat === false) {
          return false;
        }
        rp++;
      }

    }

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
      if(rtoken.repeat !== false) {
        currentNode.sp = sp - 1;
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
  var repeat = token.charAt(token.length - 1);
  if(repeat === '*' || repeat === '?' || repeat === '+') {
    token = token.substr(0, token.length - 1);
  } else {
    repeat = false;
  }
  var named = token.split(":");
  if(named.length === 2) {
    return {
      'type': named[1],
      'repeat': repeat,
      'name' :named[0]
    };
  }
  return {
    'type': token,
    'repeat': repeat
  };
}

function compileGrammar(grammar, tokenDef) {
  var keys = Object.keys(grammar), i, j;
  var allValidKeys = keys.concat(Object.keys(tokenDef));
  var gram = {};

  for(i=0; i<keys.length; i++) {
    var line = grammar[keys[i]];
    var key = keys[i];
    var rules = line.rules;

    var splitted_rules = [];

    for(j=0; j<rules.length; j++) {
      var tokens = splitTrim(rules[j], ' ');
      tokens = tokens.map(function(t) {
        var token = grammarToken(t);
        if(allValidKeys.indexOf(token.type) === -1 && token.type !== 'EOF') {
          throw "Invalid token type used in the grammar: " + token.type;
        }
        return token;
      });
      splitted_rules.push({key: key, index:j, tokens:tokens});
    }

    gram[key] = {rules: splitted_rules, hooks: line.hooks};
  }
  gram.tokenDef = tokenDef;
  gram.parse = function(stream) {
    return parse(stream, gram);
  };
  return gram;
}

// those are module globals
var stack = [];
var memoization = {};

function parse(stream, grammar) {
  var bestResult = {type:'START', sp:0, complete:false}, i, result;
  if(typeof stream === 'string') {
    stream = tokenize(stream, grammar.tokenDef);
  }
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
        inputLength:stream.length
      };
    }
  }
  return bestResult;
}

window.EPEG = {
  parse: parse,
  stack: stack,
  compileGrammar: compileGrammar,
  tokenize: tokenize,
  memoization: memoization
};

})();