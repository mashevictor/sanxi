"""打印园区表和员工表（按地址维度统计）"""
import os
import pandas as pd

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(BASE)

# ========== 客户数据：提取地址 ==========
customer_rows = []
for f, addr_col, park_col, type_name in [
    ('首访数据.xlsx', '首访地址', '招商园区', '首访'),
    ('项目数据.xlsx', '项目+拜访人地址', '招商园区', '项目'),
    ('回访数据.xlsx', '回访+拜访人地址', '招商园区', '回访'),
]:
    df = pd.read_excel(f)
    for _, r in df.iterrows():
        addr = str(r.get(addr_col, '')).strip()
        if not addr or addr == 'nan':
            continue
        company = str(r.get('企业全称 *', r.get('企业全称', ''))).strip()
        park = str(r.get(park_col, '')).strip()
        customer_rows.append({
            '类型': type_name,
            '企业全称': company,
            '拜访地址': addr,
            '招商园区': park,
        })

cust_df = pd.DataFrame(customer_rows)

# 园区表：以「拜访地址」为唯一标识（每个地址 = 一个派单点位/公司）
park_from_customers = (
    cust_df.groupby('拜访地址', as_index=False)
    .agg({
        '企业全称': lambda x: '、'.join(sorted(set(x))),
        '招商园区': lambda x: '、'.join(sorted(set(x))),
        '类型': lambda x: '、'.join(sorted(set(x))),
    })
    .rename(columns={'拜访地址': '园区地址'})
)
park_from_customers.insert(0, '序号', range(1, len(park_from_customers) + 1))
park_from_customers.insert(1, '园区名称', [f'点位{i}' for i in range(1, len(park_from_customers) + 1)])

# ========== 员工表 ==========
raw = pd.read_excel('派单员工表 (1).xls', header=None)
emp_rows = []
for _, r in raw.iloc[2:].dropna(how='all').iterrows():
    if pd.isna(r.iloc[0]):
        continue
    emp_rows.append({
        '姓名': str(r.iloc[0]),
        '地区': str(r.iloc[1]),
        '招商园区': str(r.iloc[2]),
        '职责': str(r.iloc[3]),
        '状态': str(r.iloc[4]),
        '出发地址': str(r.iloc[5]),
        'Plus能力': str(r.iloc[6]),
        '单量': str(r.iloc[7]),
    })
emp_df = pd.DataFrame(emp_rows)
emp_df.insert(0, '序号', range(1, len(emp_df) + 1))

# ========== 输出 ==========
print('=' * 80)
print('统计摘要')
print('=' * 80)
print(f'客户单总条数:     {len(cust_df)}')
print(f'唯一拜访地址数:   {cust_df["拜访地址"].nunique()}  ← 相当于不同公司/点位')
print(f'唯一招商园区数:   {cust_df["招商园区"].nunique()}')
print(f'员工总数:         {len(emp_df)}')
print(f'员工出发地址唯一: {emp_df["出发地址"].nunique()}')
print(f'差额(地址-员工):  {cust_df["拜访地址"].nunique() - len(emp_df)}')

print('\n' + '=' * 80)
print('园区表（按拜访地址去重，每个地址=一个点位）')
print('=' * 80)
pd.set_option('display.max_columns', None)
pd.set_option('display.width', 200)
pd.set_option('display.max_colwidth', 50)
print(park_from_customers.to_string(index=False))

print('\n' + '=' * 80)
print('员工表（派单员工表 (1).xls）')
print('=' * 80)
print(emp_df.to_string(index=False))

# 保存 Excel 供用户查看
park_from_customers.to_excel(os.path.join(BASE, '园区表_按地址.xlsx'), index=False)
emp_df.to_excel(os.path.join(BASE, '员工表_导出.xlsx'), index=False)
print('\n已保存: 园区表_按地址.xlsx, 员工表_导出.xlsx')
