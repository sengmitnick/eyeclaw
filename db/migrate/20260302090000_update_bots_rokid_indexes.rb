class UpdateBotsRokidIndexes < ActiveRecord::Migration[7.2]
  def change
    # 移除 rokid_user_id 的唯一索引（因为我们现在允许同一用户绑定不同设备）
    remove_index :bots, :rokid_user_id if index_exists?(:bots, :rokid_user_id)
    
    # 添加 (rokid_device_id, rokid_user_id) 复合索引，支持唯一性验证
    add_index :bots, [:rokid_device_id, :rokid_user_id], name: 'index_bots_on_rokid_device_user', unique: true
  end
end
