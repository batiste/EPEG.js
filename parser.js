(function(){

function tokenize(input, tokens) {
  // this keep the order of declaration
  var keys = Object.keys(tokens);
  var stream = [];
  var len = input.length, candidate, i, candidate_key;

  while(len > 0) {
    candidate = null;
    for(i=0; i<keys.length; i++) {
      var key = keys[i];
      var token = tokens[key];
      var match = input.match(token);
      if(match !== null) {
        // the algo is greedy
        if(candidate && candidate.length >= match[0].length) {
          continue;
        }
        candidate = match[0];
        candidate_key = key;
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
  });
  return params;
}

function growLR(grammar, rule, stream, pos, memo) {
  var sp, result;
  while(true) {
    sp = pos;
    result = evalRuleBody(grammar, rule, stream, sp);

    // ensure some progress is made
    if(result === false || result[1] <= memo[1]) {
      break;
    }
    memo[0] = result[0];
    memo[1] = result[1];
    memo[2] = result[2];
  }
  return memo;
}

function memoEval(grammar, rule, stream, pointer) {

  var memo_entry = memoization[rule.key+';'+pointer+';'+rule.index];
  var memo2_entry = memoization2[rule.key+';'+pointer];

  if(memo2_entry !== undefined) {
    return memo2_entry;
  }

  if(memo_entry === false) {
    return false;
  }
  if(memo_entry !== undefined) {
    return memo_entry;
  }

  // avoid infinite left recursion
  memoization[rule.key+';'+pointer+';'+rule.index] = false;

  return evalRuleBody(grammar, rule, stream, pointer);

}

function evalRuleBody(grammar, rule, stream, pointer) {

  var sp = pointer; // stream pointer
  var rp = 0; // rule pointer
  var i, j;
  var parsed = [];

  var rtoken = rule.tokens[rp];
  var stoken = stream[sp];

  while(rtoken && stoken) {

    if(grammar[rtoken.type]) {

      var expand_rules = grammar[rtoken.type].rules;
      result = false;

      var m = memoization2[rtoken.type+';'+sp];
      if(m) {
        result = m;
      }

      if(!result) {
        for(j=0; j<expand_rules.length; j++) {
          var r = expand_rules[j];

          result = memoEval(grammar, r, stream, sp);
          if(result) {

            memoization[r.key+';'+sp+';'+r.index] = result;
            memoization2[r.key+';'+sp] = result;

            result = growLR(grammar, rule, stream, pointer, result);
            //rp = result[2];

            break;
          }
        }
      }

      if(result) {
        sp = result[1];
        //rp = result[2];

        parsed.push(result);
      } else {
        return false;
      }

      rp++;

    } else {

      if(stoken.type == rtoken.type) {
        parsed.push(copyToken(stoken, rtoken));
        sp++;
        rp++;
      } else {
        return false;
      }

    }

    rtoken = rule.tokens[rp];
    stoken = stream[sp];

    if(rtoken === undefined) {
      return [parsed, sp, rp];
    }

    if(stoken === undefined) {
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
  if(named.length == 2) {
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
  var keys = Object.keys(grammar);
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
        if(allValidKeys.indexOf(token.type) == -1) {
          throw "Invalid token type in the grammar: " + token.type;
        }
        return token;
      });
      splitted_rules.push({key: key, index:j, tokens:tokens});
    }

    gram[key] = {rules:splitted_rules, func:line.func, consume:(line.consume || 0)};
  }
  return gram;
}

var stack = []; // TODO: not a global?
var memoization = {};
var memoization2 = {};
function parse(stream, grammar) {
  for(i=0; i<grammar.START.rules.length; i++) {
    stack = [];
    memoization = {};
    memoization2 = {};
    result = memoEval(grammar, grammar.START.rules[i], stream, 0);
    if(result) {
      return {type:'START', value:result[0],
        repeat:false, consumed: result[1],
        complete:result[1] === stream.length, l:stream.length};
    }
  }
  return false;
}

window.EPEG = {
  parse: parse,
  stack: stack,
  compileGrammar: compileGrammar,
  tokenize: tokenize,
  memoization: memoization
};

})();