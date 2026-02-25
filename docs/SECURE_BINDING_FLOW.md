# 安全的 Rokid 设备绑定流程

## 问题背景

### 旧方案的安全隐患

之前的绑定方案使用 `BOT_{id}` 格式的二维码，存在严重的安全漏洞：

```
二维码内容: BOT_1
```

**安全风险：**
1. **可枚举攻击**：黑客可以批量尝试 `BOT_1`, `BOT_2`, `BOT_3`...
2. **永久有效**：二维码长期有效，被拍摄后可反复使用
3. **无防护**：任何人扫描都能绑定到该 Bot
4. **易泄露**：Bot ID 直接暴露在 URL 中

**攻击场景示例：**
```bash
# 黑客可以轻松枚举所有 Bot
for i in {1..1000}; do
  curl /sse/rokid -d "image_url=BOT_$i"
done
```

---

## 新的安全方案

### 核心设计

使用**一次性临时令牌**替代固定的 Bot ID：

```ruby
# 令牌示例
token: "efd114623ca1a4214b9c8a2a4ade1227"  # 32字符随机字符串
expires_at: 5.minutes.from_now             # 5分钟后过期
used_at: nil                                # 未使用
```

### 安全特性

1. **随机性**：32字符十六进制令牌（16^32 = 无限可能性）
2. **时效性**：5分钟后自动失效
3. **一次性**：使用后立即标记为已使用
4. **不可枚举**：无法通过猜测获得有效令牌
5. **自动清理**：过期和已使用的令牌定期清理

---

## 技术实现

### 1. 数据库模型

```ruby
# app/models/binding_token.rb
class BindingToken < ApplicationRecord
  belongs_to :bot
  
  # 自动生成令牌和过期时间
  before_validation :generate_token, on: :create
  before_validation :set_expiration, on: :create
  after_create :cleanup_old_tokens
  
  # 验证令牌有效性
  def valid_for_binding?
    return false if used_at.present?        # 已使用
    return false if expires_at < Time.current  # 已过期
    true
  end
  
  # 标记为已使用
  def mark_as_used!(device_id)
    update!(used_at: Time.current, rokid_device_id: device_id)
  end
  
  private
  
  def generate_token
    self.token ||= SecureRandom.hex(16)  # 32字符随机令牌
  end
  
  def set_expiration
    self.expires_at ||= 5.minutes.from_now
  end
end
```

### 2. 网页端：生成二维码

```erb
<!-- app/views/bots/show.html.erb -->
<% 
  # 获取或生成绑定令牌
  @binding_token = @bot.binding_tokens
    .where('expires_at > ?', Time.current)
    .where(used_at: nil)
    .first
  @binding_token ||= @bot.binding_tokens.create!
%>

<!-- 显示二维码 -->
<%= image_tag "https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=#{@binding_token.token}" %>

<p>有效期: <%= distance_of_time_in_words_to_now(@binding_token.expires_at) %></p>
<p>此令牌仅用于一次性绑定，5分钟后自动失效</p>
```

### 3. 服务端：验证令牌

```ruby
# app/controllers/rokid_sse_controller.rb
def handle_binding_photo_result_hijack(io, message_id, agent_id, image_url)
  # 1. 解析二维码
  qr_content = decode_qr_code_from_url(image_url)
  
  # 2. 查找令牌
  binding_token = BindingToken.find_by(token: qr_content)
  unless binding_token
    return error("无效的绑定令牌，请刷新网页后重新扫码。")
  end
  
  # 3. 验证有效性
  unless binding_token.valid_for_binding?
    if binding_token.used_at.present?
      return error("此令牌已被使用，请刷新网页后重新扫码。")
    else
      return error("令牌已过期，请刷新网页后重新扫码。")
    end
  end
  
  # 4. 执行绑定
  bot = binding_token.bot
  if bot.update(rokid_device_id: agent_id)
    binding_token.mark_as_used!(agent_id)
    success("绑定成功！您现在可以使用 #{bot.name} 了。")
  end
end
```

---

## 绑定流程

### 完整流程图

```
用户                    网页                    眼镜设备               服务器
 |                       |                        |                      |
 |--1. 打开 /bots/1 ---->|                        |                      |
 |                       |--2. 生成临时令牌------>|                      |
 |                       |<--返回二维码---------- |                      |
 |<--显示二维码---------- |                        |                      |
 |                       |                        |                      |
 |                       |                    3. 用户说话触发            |
 |                       |                        |--4. 请求 /sse/rokid-->|
 |                       |                        |<--返回 take_photo-----|
 |                       |                        |                      |
 |                       |                    5. 拍摄二维码               |
 |                       |                        |--6. 发送图片-------->|
 |                       |                        |                      |
 |                       |                        |        7. 解析令牌    |
 |                       |                        |        8. 验证有效性  |
 |                       |                        |        9. 绑定设备    |
 |                       |                        |        10. 标记已使用 |
 |                       |                        |<--11. 绑定成功-------|
 |                       |                        |                      |
 |                       |                   12. 后续对话正常进行          |
```

### 步骤说明

1. **用户访问 Bot 页面** (`/bots/1`)
2. **系统生成临时令牌**：32字符随机字符串，5分钟有效期
3. **显示二维码**：包含令牌，用户提前查看
4. **眼镜设备触发绑定**：发送消息到 `/sse/rokid`
5. **系统返回拍照指令**：`take_photo` 命令
6. **设备拍摄二维码**：发送图片 URL
7. **系统解析令牌**：调用二维码识别 API
8. **验证令牌**：检查是否存在、过期、已使用
9. **执行绑定**：更新 `bot.rokid_device_id`
10. **标记已使用**：`binding_token.mark_as_used!(agent_id)`
11. **返回成功**：绑定完成
12. **正常对话**：后续消息正常转发到 OpenClaw

---

## 错误处理

### 1. 图片无二维码

```
❌ 未能识别二维码，请重新对准二维码后再试。
```

**处理：** 清除绑定状态，允许重试

### 2. 无效令牌

```
❌ 无效的绑定令牌，请刷新网页后重新扫码。
```

**原因：** 令牌不存在于数据库中（可能是伪造的）

### 3. 令牌已使用

```
❌ 此令牌已被使用，请刷新网页后重新扫码。
```

**原因：** 令牌已经被其他设备使用过

### 4. 令牌已过期

```
❌ 令牌已过期，请刷新网页后重新扫码。
```

**原因：** 超过5分钟有效期

### 5. Bot 已被其他设备绑定

```
❌ 此 Bot 已被其他设备绑定，请先解绑后再试。
```

**处理：** 用户需要在网页上解绑后重新绑定

---

## 安全测试

### 测试用例

#### ✅ 正常绑定流程

```bash
# 1. 生成令牌
rails runner 'bot = Bot.first; token = bot.binding_tokens.create; puts token.token'
# 输出: efd114623ca1a4214b9c8a2a4ade1227

# 2. 模拟设备拍照并发送令牌
curl --location 'http://localhost:3000/sse/rokid' \
  --header 'Authorization: Bearer ak_xxx' \
  --data '{"message_id":"123","agent_id":"device_999","message":[{"role":"user","type":"image","image_url":"https://api.qrserver.com/v1/create-qr-code/?data=efd114623ca1a4214b9c8a2a4ade1227"}]}'

# 结果: ✅ 绑定成功！您现在可以使用 小龙虾 了。
```

#### ❌ 重复使用令牌（攻击场景）

```bash
# 第二个设备尝试使用相同令牌
curl --location 'http://localhost:3000/sse/rokid' \
  --data '{"agent_id":"hacker_666","message":[{"type":"image","image_url":"https://api.qrserver.com/v1/create-qr-code/?data=efd114623ca1a4214b9c8a2a4ade1227"}]}'

# 结果: ❌ 此令牌已被使用，请刷新网页后重新扫码。
```

#### ❌ 伪造令牌（攻击场景）

```bash
curl --location 'http://localhost:3000/sse/rokid' \
  --data '{"agent_id":"hacker_666","message":[{"type":"image","image_url":"https://api.qrserver.com/v1/create-qr-code/?data=FAKE_HACKER_TOKEN_123"}]}'

# 结果: ❌ 无效的绑定令牌，请刷新网页后重新扫码。
```

#### ❌ 枚举攻击（攻击场景）

```bash
# 黑客尝试枚举令牌（旧方案可行，新方案失败）
for i in {1..100}; do
  curl --data '{"message":[{"image_url":"https://api.qrserver.com/v1/create-qr-code/?data=BOT_$i"}]}'
done

# 结果: ❌ 全部失败，因为令牌是32字符随机字符串，无法枚举
```

---

## 性能优化

### 自动清理机制

```ruby
# app/models/binding_token.rb
after_create :cleanup_old_tokens

def cleanup_old_tokens
  # 每次创建新令牌时清理过期和已使用的
  BindingToken.cleanup_expired
  BindingToken.cleanup_used
end
```

**触发时机：** 每次访问 `/bots/:id` 页面生成新令牌时

**清理内容：**
- 过期令牌（`expires_at < Time.current`）
- 已使用令牌（`used_at IS NOT NULL`）

---

## 安全性对比

| 特性               | 旧方案 (BOT_ID)      | 新方案 (临时令牌)           |
|--------------------|----------------------|-----------------------------|
| **可枚举性**       | ❌ 可枚举 (BOT_1, 2...) | ✅ 不可枚举 (32字符随机)    |
| **有效期**         | ❌ 永久有效          | ✅ 5分钟自动失效            |
| **重复使用**       | ❌ 可重复使用        | ✅ 一次性使用               |
| **泄露风险**       | ❌ Bot ID 直接暴露   | ✅ 令牌与 Bot ID 解耦       |
| **攻击成本**       | 低（简单枚举）       | 极高（16^32 可能性）        |
| **防护级别**       | 无                   | 高                          |

---

## 总结

**新方案优势：**
1. ✅ **防止枚举攻击**：32字符随机令牌，无法猜测
2. ✅ **时效保护**：5分钟自动失效
3. ✅ **一次性防护**：使用后立即失效
4. ✅ **自动清理**：无需手动维护
5. ✅ **用户友好**：错误提示清晰

**安全保障：**
- 黑客无法通过枚举获取有效令牌
- 即使令牌被截获，5分钟后自动失效
- 即使令牌在有效期内被使用，第二次使用会被拒绝
- Bot ID 不再直接暴露在二维码中

**用户体验：**
- 用户操作流程不变（仍然是：打开网页 → 拍二维码 → 绑定）
- 增加了时效性提示（5分钟有效期）
- 错误提示更明确（过期/已使用/无效）
