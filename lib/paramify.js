// the first character of named parameter must be a letter
// the remaining characters may be any combination of letters/numbers/underscore
var paramPattern = /\$[a-z][a-z0-9_]*\b/ig;

function sparse(sql, parameters = {}) {
  // match tokens into an array, remove leading $, filter to remove duplicates
  let sqlParams = sql.match(paramPattern).map(t => t.substring(1)).filter((val, ix, arr) => arr.indexOf(val) === ix)
  let text = sqlParams.reduce((reducedSqlQuery, param, ix) => {
    let paramPattern = new RegExp('\\$' + param + '\\b', 'g')
    return reducedSqlQuery.replace(paramPattern,'$' + (ix+1)) // pg params are 1-indexed
  }, sql)
  let values = sqlParams.map(p => parameters[p])

  return {text, values}
}

function strict(sql, parameters) {
  let bindings = Object.keys(parameters);
  let sqlParams = sql
  .match(paramPattern) // get array of $tokens
  .map(t => t.substring(1)) // remove '$' from $tokens in array
  .filter((val, ix, arr) => arr.indexOf(val) === ix) // no duplicates

  let useParams = bindings.filter(t => sqlParams.indexOf(t) !== -1).sort()
  let useValues = useParams.map(t => parameters[t])

  let unmatched = sqlParams.filter(t => bindings.indexOf(t) === -1)
  if (unmatched.length) {
    let missing = unmatched.join(", ");
    throw new Error("Missing Parameters: " + missing);
  }

  let interpolatedSql = useParams.reduce(
  function (reducedSqlQuery, param, ix) {
    let paramPattern = new RegExp('\\$' + param + '\\b', 'g');
    return reducedSqlQuery.replace(paramPattern,'$' + (ix+1)); // pg params are 1-indexed
  }, sql);

  let out = {};
  out.text = interpolatedSql;
  out.values = useValues;

  return out;
}

var Paramify = {sparse, strict}
module.exports = Paramify
