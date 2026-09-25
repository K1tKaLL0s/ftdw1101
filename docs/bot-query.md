# AstrBot 预约只读接口

适配 E:\插件\astrbot_plugin_no_at_reply_guard，保留其现有协议：
`GET /api/bot/reservations?range=this_week`，请求头 `Authorization: Bearer 原始令牌` 与 `X-Group-Id: 群号`。

网站新增环境变量（不是 Supabase 密钥）：

- `BOT_QUERY_ENABLED=true`：启用；省略或 false 时仅此接口返回503。
- `BOT_QUERY_TOKEN_SHA256=原始令牌的SHA256十六进制摘要`：不是原始令牌。
- `BOT_QUERY_ALLOWED_GROUPS=*`：按本次需求默认全部群；也支持逗号分隔的明确群号。空白关闭访问，星号仍要求令牌及有效群号。
- `BOT_QUERY_SHOW_NOTES=false`：默认不转发备注；true 可展示最多80字符。

机器人配置 `bot_query_token` 填原始令牌，或留空并在机器人宿主设置 `BOT_QUERY_TOKEN`。网站不读取原始 `BOT_QUERY_TOKEN`。机器人 `allowed_group_ids` 留空表示全部群；无需填写星号。

先应用仓库中的 `bot_reservation_slots` 迁移，再为网站导入以上配置并部署最新提交。不得直接执行 E:\插件\webs\sql 中使用 reservations/accounts 示例表的旧SQL。

支持范围 this_week/today/tomorrow/next_week，按北京时间计算；schema_version为字符串"1"，空slots仅表示查询成功但无预约。每时段真实人数与最多5名预览分开计算。删除的预约、封禁/删除账户不返回；不返回账户ID、用户名或联系方式。

生产函数只向service_role授予执行权限，不给anon/authenticated权限，使用现有服务端客户端。令牌限流通过现有数据库共享计数器执行（30次/分钟），不是实例内存计数；禁用、认证失败和群不允许均在查询数据库前终止。查询函数超时与HTTP取消上限6秒，响应no-store；EdgeOne勿为该路径添加缓存规则。

机器人令牌不授予网站写接口权限。首次联调可从机器人宿主使用相同请求头调用本接口，检查200及schema_version；缺令牌401、群不允许403、超频429、未启用/上游失败503，不能把503当暂无预约。关闭开关可独立回滚，不影响原登录/登记。

不要把原始令牌、导入文件或请求Authorization头提交Git。生成或更换令牌后，两端同步更新网站摘要与机器人原文，并重新部署网站。
