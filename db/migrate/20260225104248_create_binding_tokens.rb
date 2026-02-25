class CreateBindingTokens < ActiveRecord::Migration[7.2]
  def change
    create_table :binding_tokens do |t|
      t.string :token
      t.references :bot
      t.datetime :expires_at
      t.datetime :used_at
      t.string :rokid_device_id

      t.index :token, unique: true

      t.timestamps
    end
  end
end
