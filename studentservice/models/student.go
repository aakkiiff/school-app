package models

import "go.mongodb.org/mongo-driver/bson/primitive"

type Student struct {
	RecordID primitive.ObjectID `json:"recordId" bson:"_id,omitempty"`
	Name     string             `json:"name" bson:"name"`
	Roll     string             `json:"roll" bson:"roll"`
	Address  string             `json:"address" bson:"address"`
}
