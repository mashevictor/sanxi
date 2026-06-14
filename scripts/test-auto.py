import json, urllib.request

d = json.load(open('_sample.json', encoding='utf-8'))
# 5 random companies
cos = [c['id'] for c in d['companies'] if '金山' in c['parkName'] and '回访' in c['customerType']][:5]
payload = json.dumps({'sessionId': d['sessionId'], 'customerIds': cos}).encode('utf-8')
req = urllib.request.Request(
    'http://localhost:3002/api/dispatch/select',
    data=payload,
    headers={'Content-Type': 'application/json'},
)
resp = json.load(urllib.request.urlopen(req))
print('message:', resp['message'])
print('eligible:', resp['stats']['eligible'], '/', resp['stats']['selected'])
emps = set(p['employeeName'] for p in resp['pairings'])
print('auto employees:', emps)
for p in resp['pairings']:
    print(f"  {p['companyName'][:20]} -> {p['employeeName']} eligible={p['eligible']}")
