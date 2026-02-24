class CreateAccessKeys < ActiveRecord::Migration[7.2]
  def change
    create_table :access_keys do |t|
      t.string :name
      t.string :key
      t.text :description
      t.boolean :is_active, default: true
      t.datetime :last_used_at

      t.index :key, unique: true

      t.timestamps
    end
  end
end
