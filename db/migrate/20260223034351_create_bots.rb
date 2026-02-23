class CreateBots < ActiveRecord::Migration[7.2]
  def change
    create_table :bots do |t|
      t.string :name, default: "Untitled"
      t.text :description
      t.string :status, default: "offline"
      t.string :api_key
      t.string :sdk_token
      t.string :mcp_url
      t.string :webhook_url
      t.jsonb :config, default: {}
      t.references :user

      t.index :api_key, unique: true
      t.index :sdk_token, unique: true

      t.timestamps
    end
  end
end
