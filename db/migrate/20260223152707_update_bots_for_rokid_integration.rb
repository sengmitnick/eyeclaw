class UpdateBotsForRokidIntegration < ActiveRecord::Migration[7.2]
  def change
    # 移除 mcp_url 字段（已改为固定路由）
    remove_column :bots, :mcp_url, :string, if_exists: true
    
    # 添加 rokid_device_id 字段（用于关联乐奇眼镜设备）
    add_column :bots, :rokid_device_id, :string
    add_index :bots, :rokid_device_id
  end
end
