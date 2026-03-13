export async function fetchCoreVocabulary() {
  // We use Lexique-style frequency data via an open API or 
  // a raw data source specified in your backend doc
  const API_URL = "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/fr/fr_50k.txt";
  
  const response = await fetch(API_URL);
  if (!response.ok) {
    // By throwing an error, we allow the UI to handle the failure state.
    throw new Error(`Failed to fetch vocabulary: ${response.statusText}`);
  }
  const text = await response.text();
  
  // Process the top 300 words
  return text.split('\n').slice(0, 300).map(line => {
    const [word, count] = line.split(' ');
    // It's good practice to parse numeric values and handle potential NaN.
    return { french: word, frequency: parseInt(count, 10) || 0 };
  });
}