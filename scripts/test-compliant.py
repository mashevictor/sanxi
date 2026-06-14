import json, urllib.request

d = json.load(open('_sample.json', encoding='utf-8'))

def test(label, cos):
    payload = json.dumps({'sessionId': d['sessionId'], 'customerIds': cos}).encode('utf-8')
    req = urllib.request.Request(
        'http://localhost:3002/api/dispatch/select',
        data=payload,
        headers={'Content-Type': 'application/json'},
    )
    resp = json.load(urllib.request.urlopen(req))
    print(f'\n=== {label} ===')
    print(resp['message'])
    print('matched:', resp['stats']['matched'], 'unmatched:', resp['stats']['unmatched'])
    for p in resp['pairings']:
        print(f'  OK: {p["companyName"][:18]} -> {p["employeeName"]}')
    for u in resp.get('unmatchedCompanies', []):
        print(f'  FAIL: {u["companyName"][:18]} | {u["reason"]}')

# 前4家首访（截图场景）
first4 = [c['id'] for c in d['companies'][:4]]
test('4家首访', first4)

# 5家金山回访
jinshan = [c['id'] for c in d['companies'] if '金山' in c['parkName'] and '回访' in c['customerType']][:5]
test('5家金山回访', jinshan)
