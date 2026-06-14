import json, urllib.request

d = json.load(open('_sample.json', encoding='utf-8'))

# 选回访客户 + 后道员工（韩哲川等金山园区）
followup_cos = [c['id'] for c in d['companies'] if '回访' in c['customerType']][:3]
back_emps = [e['id'] for e in d['employees'] if '后道' in '/'.join(e.get('roles', [])) and '金山' in e['serviceParkName']][:3]

print('companies:', len(followup_cos), 'employees:', len(back_emps))

payload = json.dumps({
    'sessionId': d['sessionId'],
    'customerIds': followup_cos,
    'employeeIds': back_emps,
}).encode('utf-8')
req = urllib.request.Request(
    'http://localhost:3002/api/dispatch/select',
    data=payload,
    headers={'Content-Type': 'application/json'},
)
resp = json.load(urllib.request.urlopen(req))
print('message:', resp['message'])
print('eligible:', resp['stats']['eligible'], '/', resp['stats']['selected'])
for p in resp['pairings']:
    ok = '合规' if p['eligible'] else '不合规'
    print(f"  [{ok}] {p['companyName']} -> {p['employeeName']} (score={p['score']})")
