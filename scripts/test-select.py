import json, urllib.request

d = json.load(open('_sample.json', encoding='utf-8'))
cos = [c['id'] for c in d['companies'][:5]]
emps = [e['id'] for e in d['employees'][:5]]
payload = json.dumps({
    'sessionId': d['sessionId'],
    'customerIds': cos,
    'employeeIds': emps,
}).encode('utf-8')
req = urllib.request.Request(
    'http://localhost:3002/api/dispatch/select',
    data=payload,
    headers={'Content-Type': 'application/json'},
)
resp = json.load(urllib.request.urlopen(req))
print('message:', resp['message'])
print('optimized:', resp['optimized'])
print('eligible:', resp['stats']['eligible'], '/', resp['stats']['selected'])
for p in resp['pairings']:
    print(f"\n{p['companyName']} -> {p['employeeName']} eligible={p['eligible']}")
    for r in p['rules']:
        mark = 'OK' if r['passed'] else 'FAIL'
        print(f'  [{mark}] {r["rule"]}: {r["message"]}')
