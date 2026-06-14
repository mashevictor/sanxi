"""生成园区与员工数量一致的示例 Excel 数据"""
import json
import os

try:
    import openpyxl
    from openpyxl import Workbook
except ImportError:
    import subprocess, sys
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'openpyxl', 'xlrd', '-q'])
    import openpyxl
    from openpyxl import Workbook

BASE = os.path.dirname(os.path.abspath(__file__))

# 5 个园区，与 5 名员工一一对应
PARKS = [
    {'园区名称': '加盟-金山资本现代产业园', '城市': '上海市', '园区地址': '上海市金山区亭林镇产业园路1号'},
    {'园区名称': '宝山高新', '城市': '上海市', '园区地址': '上海市宝山区淞发路25号'},
    {'园区名称': '山东济南', '城市': '上海市', '园区地址': '上海市浦东新区世博园区'},
    {'园区名称': '江苏徐州', '城市': '上海市', '园区地址': '上海市宝山区聚丰园路园区'},
    {'园区名称': '江苏镇江', '城市': '上海市', '园区地址': '上海市普陀区中山北路园区'},
]

EMPLOYEES = [
    ['韩哲川', '上海市', '加盟-金山资本现代产业园', '后道', '正常', '上海市浦东新区金桥路', '后道:Plus0,Plus1,PlusN', '上午单,下午单-1', ''],
    ['崔宏芝', '上海市', '宝山高新', '后道', '正常', '上海市松江区泽悦路', '后道:Plus0,Plus1,PlusN', '上午单,下午单-1', ''],
    ['殷汝飞', '上海市', '山东济南', '项目,前道', '正常', '上海市浦东新区浦东大道', '前道:Plus0,项目:Plus0,Plus1,PlusN', '上午单,下午单-1', ''],
    ['王睿', '上海市', '江苏徐州', '项目,前道', '正常', '上海市宝山区聚丰园路', '前道:Plus0,项目:Plus0,Plus1,PlusN', '上午单,下午单-1', ''],
    ['刘帅', '上海市', '江苏镇江', '项目,前道', '正常', '上海市普陀区甘泉路', '前道:Plus0,项目:Plus0,Plus1,PlusN', '上午单,下午单-1', ''],
]

# 园区数据.xlsx
wb = Workbook()
ws = wb.active
ws.title = '园区表'
ws.append(['园区名称', '城市', '园区地址'])
for p in PARKS:
    ws.append([p['园区名称'], p['城市'], p['园区地址']])
wb.save(os.path.join(BASE, '园区数据.xlsx'))

# 员工基础表_示例.xlsx
wb2 = Workbook()
ws2 = wb2.active
ws2.title = '导出信息'
ws2.append(['员工基础信息表（示例）'])
ws2.append([])
ws2.append(['姓名', '地区', '招商园区', '职责', '状态', '出发地址', '回访PlusN次', '单量', '备注'])
for row in EMPLOYEES:
    ws2.append(row)
wb2.save(os.path.join(BASE, '员工基础表_示例.xlsx'))

print('已生成: 园区数据.xlsx, 员工基础表_示例.xlsx')
print(f'园区数: {len(PARKS)}, 员工数: {len(EMPLOYEES)}')
