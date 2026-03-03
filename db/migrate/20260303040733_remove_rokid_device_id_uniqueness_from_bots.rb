class RemoveRokidDeviceIdUniquenessFromBots < ActiveRecord::Migration[7.2]
  def change
    # 移除复合唯一索引 (rokid_device_id, rokid_user_id)
    # agent_id 是灵珠平台分配的固定值，不应该作为唯一性约束
    # 只保留 rokid_user_id 的唯一性（一个灵珠用户只能绑定一个 Bot）
    remove_index :bots, [:rokid_device_id, :rokid_user_id], 
                 name: 'index_bots_on_rokid_device_user', 
                 if_exists: true
    
    # 重新添加 rokid_user_id 的唯一索引
    add_index :bots, :rokid_user_id, unique: true, if_not_exists: true
    
    # 添加 rokid_device_id 的普通索引（不唯一），用于查询优化
    add_index :bots, :rokid_device_id, if_not_exists: true
  end
end
