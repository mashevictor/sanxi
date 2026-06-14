# 派单系统数据模型说明

## 核心原则

**园区与员工是独立的主数据，派单前互不从属。**  
「派单员工表」Excel 实际是**员工基础信息表**（派单前输入），**派单结果**和**派单员工信息表**才是派单后输出，不能混用。

## 数据分层

```
派单前（主数据 INPUT）          派单引擎              派单后（结果 OUTPUT）
─────────────────────    ──────────────    ─────────────────────────
园区表 InvestmentPark  ─┐
员工表 Employee        ─┼──▶ 7条匹配规则 ──▶ 派单结果 DispatchResult
待派单客户 Customer    ─┘                    派单员工信息表 DispatchEmployeeSheet
```

## 表结构

### 1. 园区表 `InvestmentPark`（主数据）

| 字段 | 说明 |
|------|------|
| name | 园区名称 |
| cityId / cityName | 所在城市 |
| address | 园区地址 |
| contact / phone | 联系人/电话 |
| status | 状态 |

> 园区是独立实体，**不包含员工列表**。

数据来源：
- 可选上传 `园区数据.xlsx`（列：园区名称、城市、园区地址）
- 或从待派单客户中的「招商园区」字段自动补全（地址为空待补充）

### 2. 员工表 `Employee`（主数据）

| 字段 | 说明 |
|------|------|
| name | 姓名 |
| cityId / cityName | 所在地区 |
| departureAddress | **出发地址**（通勤计算用） |
| serviceParkId / serviceParkName | **负责服务的园区**（规则6匹配用，非归属关系） |
| roles | 职责：前道/项目/后道 |
| plusCapabilities | Plus 能力 |
| orderCapacity | 单量容量：上午单/下午单 |
| status | 正常/停用/请假 |

> Excel 中「招商园区」列语义 = **员工负责服务的园区范围**，不是员工"属于"哪个园区。

数据来源：`派单员工表 (1).xls`（实为员工基础信息导入表）

### 3. 待派单客户 `CustomerOrder`（主数据）

| 字段 | 说明 |
|------|------|
| companyName | 企业全称 |
| address | 拜访地址 |
| parkId / parkName | 客户所属招商园区 |
| customerType | 首访/项目/回访 |
| appointmentTime / timeSlot | 预约时间/时段 |
| plusCount | Plus 次数 |
| designatedPerson / rejectedPerson | 指定人/放弃人 |

数据来源：`首访数据.xlsx`、`项目数据.xlsx`、`回访数据.xlsx`

### 4. 派单结果 `DispatchResult`（派单后输出）

每条记录 = 一个客户分配给一名员工，含通勤时间、匹配得分等。

### 5. 派单员工信息表 `DispatchEmployeeSheet`（派单后输出）

每位员工当天的派单汇总：总单数、各时段单数、总通勤、明细列表。

## 派单规则中的园区匹配（规则6）

```
客户.parkName  ===  员工.serviceParkName
```

员工通过「负责服务的园区」与客户匹配，而非预先绑定到园区下。

## 之前的错误

| 错误 | 修正 |
|------|------|
| 园区下挂员工列表 | 园区、员工独立存储 |
| 员工.parkId 表示归属园区 | 改为 serviceParkId（服务范围） |
| 园区表无地址字段 | 增加 address 等字段 |
| 派单员工表当输入又当输出 | 输入=员工基础表，输出=派单员工信息表 |
| 选择模式要求员工属于所选园区 | 改为独立多选，由规则引擎匹配 |
