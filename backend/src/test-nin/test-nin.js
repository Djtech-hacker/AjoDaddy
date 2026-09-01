fetch('https://api.prembly.com/identitypass/verification/nin', {
  method: 'POST',
  headers: {
    'x-api-key': 'test_sk_14990dc0893448119d9cc9b88d7b06fb',
    'app-id': 'test_pk_196a23d87ffb4ae6af0faa2869b9cc10',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ number_nin: '12345678901' })
}).then(r => r.json()).then(console.log).catch(console.error)